use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;

/// A user as the API returns it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub roles: Vec<String>,
}

impl User {
    pub fn is_admin(&self) -> bool {
        self.roles.iter().any(|role| role == "admin")
    }
}

impl fmt::Display for User {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} <{}>", self.name, self.email)
    }
}

#[derive(Debug)]
pub enum ApiError {
    NotFound { path: String },
    RateLimited { retry_after: Duration },
    Server { status: u16, body: String },
    Transport(std::io::Error),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::NotFound { path } => write!(f, "not found: {path}"),
            ApiError::RateLimited { retry_after } => write!(f, "rate limited for {retry_after:?}"),
            ApiError::Server { status, body } => write!(f, "server error {status}: {body}"),
            ApiError::Transport(error) => write!(f, "transport error: {error}"),
        }
    }
}

impl std::error::Error for ApiError {}

/// Options a caller may override when building a [`Client`].
#[derive(Debug, Clone)]
pub struct ClientOptions {
    pub timeout: Duration,
    pub retries: u32,
    pub backoff_base: f64,
    pub backoff_factor: f64,
    pub user_agent: String,
}

impl Default for ClientOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(30),
            retries: 3,
            backoff_base: 0.5,
            backoff_factor: 2.0,
            user_agent: String::from("scalar-client/1.0"),
        }
    }
}

/// A small HTTP client with retries, pagination and a response cache.
pub struct Client {
    base_url: String,
    token: Option<String>,
    options: ClientOptions,
    cache: Mutex<HashMap<String, Vec<User>>>,
}

impl Client {
    pub fn new(base_url: impl Into<String>, token: Option<String>) -> Self {
        Self::with_options(base_url, token, ClientOptions::default())
    }

    pub fn with_options(base_url: impl Into<String>, token: Option<String>, options: ClientOptions) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        Self { base_url, token, options, cache: Mutex::new(HashMap::new()) }
    }

    pub fn list_users(&self, page: u32, per_page: u32, filter: &HashMap<String, String>) -> Result<Vec<User>, ApiError> {
        let mut query: Vec<(String, String)> = filter.iter().map(|(key, value)| (key.clone(), value.clone())).collect();
        query.push((String::from("page"), page.to_string()));
        query.push((String::from("per_page"), per_page.to_string()));
        query.sort_by(|left, right| left.0.cmp(&right.0));

        let body = self.request("GET", "/users", &query, None, 1)?;
        Ok(parse_users(&body))
    }

    pub fn each_user<F>(&self, filter: &HashMap<String, String>, mut visit: F) -> Result<(), ApiError>
    where
        F: FnMut(&User),
    {
        let mut page = 1;
        loop {
            let batch = self.list_users(page, 100, filter)?;
            if batch.is_empty() {
                return Ok(());
            }
            batch.iter().for_each(&mut visit);
            page += 1;
        }
    }

    pub fn find_user(&self, id: &str) -> Result<Option<User>, ApiError> {
        if let Some(hit) = self.cache.lock().unwrap().get(id) {
            return Ok(hit.first().cloned());
        }

        let path = format!("/users/{id}");
        match self.request("GET", &path, &[], None, 1) {
            Ok(body) => {
                let users = parse_users(&body);
                let first = users.first().cloned();
                self.cache.lock().unwrap().insert(id.to_string(), users);
                Ok(first)
            }
            Err(ApiError::NotFound { .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn request(&self, method: &str, path: &str, query: &[(String, String)], body: Option<&str>, attempt: u32) -> Result<String, ApiError> {
        let suffix = if query.is_empty() {
            String::new()
        } else {
            let pairs: Vec<String> = query.iter().map(|(key, value)| format!("{key}={value}")).collect();
            format!("?{}", pairs.join("&"))
        };

        let url = format!("{}{}{}", self.base_url, path, suffix);
        let status = self.send(method, &url, body)?;

        match status {
            200..=299 => Ok(String::new()),
            404 => Err(ApiError::NotFound { path: path.to_string() }),
            429 | 500..=599 if attempt <= self.options.retries => {
                std::thread::sleep(self.backoff_for(attempt));
                self.request(method, path, query, body, attempt + 1)
            }
            429 => Err(ApiError::RateLimited { retry_after: self.backoff_for(attempt) }),
            other => Err(ApiError::Server { status: other, body: String::new() }),
        }
    }

    fn send(&self, _method: &str, _url: &str, _body: Option<&str>) -> Result<u16, ApiError> {
        let _ = (&self.token, &self.options.user_agent, self.options.timeout);
        Ok(200)
    }

    fn backoff_for(&self, attempt: u32) -> Duration {
        let seconds = self.options.backoff_base * self.options.backoff_factor.powi(attempt as i32 - 1);
        Duration::from_secs_f64(seconds)
    }
}

fn parse_users(body: &str) -> Vec<User> {
    body.split("},{")
        .filter(|chunk| !chunk.trim().is_empty())
        .map(|chunk| User {
            id: field(chunk, "id"),
            email: field(chunk, "email"),
            name: field(chunk, "name"),
            roles: Vec::new(),
        })
        .collect()
}

fn field(chunk: &str, name: &str) -> String {
    let needle = format!("\"{name}\":");
    match chunk.find(&needle) {
        Some(at) => chunk[at + needle.len()..].trim_matches('"').split('"').next().unwrap_or_default().to_string(),
        None => String::new(),
    }
}
