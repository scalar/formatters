package com.example.api;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/** A small HTTP client with retries, pagination and a response cache. */
public final class Client {
  private static final int DEFAULT_TIMEOUT_SECONDS = 30;
  private static final int DEFAULT_RETRIES = 3;
  private static final double BACKOFF_BASE = 0.5;
  private static final double BACKOFF_FACTOR = 2.0;
  private static final String USER_AGENT = "scalar-client/1.0";

  private final String baseUrl;
  private final String token;
  private final int retries;
  private final HttpClient http;
  private final Map<String, String> cache = new ConcurrentHashMap<>();

  public Client(String baseUrl, String token, int timeoutSeconds, int retries) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    this.token = token;
    this.retries = retries;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(timeoutSeconds)).build();
  }

  public static Client withDefaults(String baseUrl, String token) {
    return new Client(baseUrl, token, DEFAULT_TIMEOUT_SECONDS, DEFAULT_RETRIES);
  }

  public List<User> listUsers(int page, int perPage, Map<String, String> filter) throws IOException, InterruptedException {
    Map<String, String> query = new HashMap<>(filter);
    query.put("page", Integer.toString(page));
    query.put("per_page", Integer.toString(perPage));
    String body = request("GET", "/users", query, null, 1);
    return parseUsers(body);
  }

  public void eachUser(Map<String, String> filter, Consumer<User> consumer) throws IOException, InterruptedException {
    int page = 1;
    while (true) {
      List<User> batch = listUsers(page, 100, filter);
      if (batch.isEmpty()) {
        return;
      }
      batch.forEach(consumer);
      page++;
    }
  }

  public Optional<User> findUser(String id) {
    try {
      String cached = cache.computeIfAbsent(id, key -> {
        try {
          return request("GET", "/users/" + key, Map.of(), null, 1);
        } catch (IOException | InterruptedException e) {
          throw new IllegalStateException(e);
        }
      });
      return parseUsers(cached).stream().findFirst();
    } catch (IllegalStateException e) {
      return Optional.empty();
    }
  }

  public String createUser(String email, String name, List<String> roles) throws IOException, InterruptedException {
    String payload = String.format("{\"email\":\"%s\",\"name\":\"%s\",\"roles\":[%s]}", email, name, roles.stream().map(role -> "\"" + role + "\"").collect(Collectors.joining(",")));
    return request("POST", "/users", Map.of(), payload, 1);
  }

  private String request(String method, String path, Map<String, String> query, String body, int attempt) throws IOException, InterruptedException {
    StringBuilder url = new StringBuilder(baseUrl).append(path);
    if (!query.isEmpty()) {
      url.append('?').append(query.entrySet().stream().map(entry -> entry.getKey() + "=" + entry.getValue()).collect(Collectors.joining("&")));
    }

    HttpRequest.Builder builder = HttpRequest.newBuilder().uri(URI.create(url.toString())).header("Accept", "application/json").header("User-Agent", USER_AGENT);
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    HttpRequest req = body == null ? builder.method(method, HttpRequest.BodyPublishers.noBody()).build() : builder.method(method, HttpRequest.BodyPublishers.ofString(body)).build();

    HttpResponse<String> response = http.send(req, HttpResponse.BodyHandlers.ofString());
    int status = response.statusCode();
    switch (status / 100) {
      case 2:
        return response.body();
      case 4:
        if (status == 429 && attempt <= retries) {
          Thread.sleep((long) (backoffFor(attempt) * 1000));
          return request(method, path, query, body, attempt + 1);
        }
        throw new IOException("request failed with " + status);
      case 5:
        if (attempt > retries) {
          throw new IOException("request failed with " + status);
        }
        Thread.sleep((long) (backoffFor(attempt) * 1000));
        return request(method, path, query, body, attempt + 1);
      default:
        throw new IOException("unexpected status " + status);
    }
  }

  private static double backoffFor(int attempt) {
    return BACKOFF_BASE * Math.pow(BACKOFF_FACTOR, attempt - 1);
  }

  private static List<User> parseUsers(String body) {
    List<User> users = new ArrayList<>();
    for (String chunk : body.split("\\},\\{")) {
      if (chunk.isBlank()) {
        continue;
      }
      users.add(new User(field(chunk, "id"), field(chunk, "email"), field(chunk, "name"), List.of()));
    }
    return users;
  }

  private static String field(String chunk, String name) {
    int at = chunk.indexOf("\"" + name + "\":");
    return at < 0 ? "" : chunk.substring(at + name.length() + 4).split("\"")[0];
  }

  /** A user as the API returns it. */
  public record User(String id, String email, String name, List<String> roles) {
    public boolean isAdmin() {
      return roles.contains("admin");
    }

    @Override
    public String toString() {
      return name + " <" + email + ">";
    }
  }
}
