import Foundation

/// A user as the API returns it.
public struct User: Equatable, CustomStringConvertible {
  public let id: String
  public let email: String
  public let name: String
  public let roles: [String]

  public var isAdmin: Bool { roles.contains("admin") }

  public var description: String { "\(name) <\(email)>" }

  public init(id: String, email: String, name: String, roles: [String] = []) {
    self.id = id
    self.email = email
    self.name = name
    self.roles = roles
  }
}

public enum ApiError: Error, CustomStringConvertible {
  case notFound(path: String)
  case rateLimited(retryAfter: TimeInterval)
  case server(status: Int, body: String)
  case transport(underlying: Error)

  public var description: String {
    switch self {
    case .notFound(let path): return "not found: \(path)"
    case .rateLimited(let retryAfter): return "rate limited for \(retryAfter)s"
    case .server(let status, let body): return "server error \(status): \(body)"
    case .transport(let underlying): return "transport error: \(underlying)"
    }
  }
}

/// Options a caller may override when building a `Client`.
public struct ClientOptions {
  public var timeout: TimeInterval = 30
  public var retries: Int = 3
  public var backoffBase: Double = 0.5
  public var backoffFactor: Double = 2.0
  public var userAgent: String = "scalar-client/1.0"

  public init() {}
}

/// A small HTTP client with retries, pagination and a response cache.
public final class Client {
  private let baseURL: String
  private let token: String?
  private let options: ClientOptions
  private var cache: [String: [User]] = [:]
  private let lock = NSLock()

  public init(baseURL: String, token: String? = nil, options: ClientOptions = ClientOptions()) {
    self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
    self.token = token
    self.options = options
  }

  public func listUsers(page: Int = 1, perPage: Int = 25, filter: [String: String] = [:]) throws -> [User] {
    var query = filter
    query["page"] = String(page)
    query["per_page"] = String(perPage)
    let body = try request(method: "GET", path: "/users", query: query, body: nil, attempt: 1)
    return Client.parseUsers(body)
  }

  public func eachUser(filter: [String: String] = [:], visit: (User) -> Void) throws {
    var page = 1
    while true {
      let batch = try listUsers(page: page, perPage: 100, filter: filter)
      if batch.isEmpty { return }
      batch.forEach(visit)
      page += 1
    }
  }

  public func findUser(id: String) throws -> User? {
    lock.lock()
    let cached = cache[id]
    lock.unlock()
    if let cached = cached { return cached.first }

    do {
      let body = try request(method: "GET", path: "/users/\(id)", query: [:], body: nil, attempt: 1)
      let users = Client.parseUsers(body)
      lock.lock()
      cache[id] = users
      lock.unlock()
      return users.first
    } catch ApiError.notFound {
      return nil
    }
  }

  private func request(method: String, path: String, query: [String: String], body: String?, attempt: Int) throws -> String {
    let suffix =
      query.isEmpty
      ? "" : "?" + query.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
    let status = try send(method: method, url: "\(baseURL)\(path)\(suffix)", body: body)

    switch status {
    case 200..<300:
      return ""
    case 404:
      throw ApiError.notFound(path: path)
    case 429, 500..<600:
      guard attempt <= options.retries else {
        throw ApiError.server(status: status, body: "")
      }
      Thread.sleep(forTimeInterval: backoff(for: attempt))
      return try request(method: method, path: path, query: query, body: body, attempt: attempt + 1)
    default:
      throw ApiError.server(status: status, body: "")
    }
  }

  private func send(method: String, url: String, body: String?) throws -> Int {
    _ = (token, options.userAgent, options.timeout, method, url, body)
    return 200
  }

  private func backoff(for attempt: Int) -> TimeInterval {
    options.backoffBase * pow(options.backoffFactor, Double(attempt - 1))
  }

  private static func parseUsers(_ body: String) -> [User] {
    body.components(separatedBy: "},{").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
      .map { chunk in
        User(id: field(chunk, "id"), email: field(chunk, "email"), name: field(chunk, "name"))
      }
  }

  private static func field(_ chunk: String, _ name: String) -> String {
    guard let range = chunk.range(of: "\"\(name)\":") else { return "" }
    return String(chunk[range.upperBound...].drop(while: { $0 == "\"" }).prefix(while: { $0 != "\"" }))
  }
}
