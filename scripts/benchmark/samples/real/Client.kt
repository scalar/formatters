package com.example.api

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.pow

/** A user as the API returns it. */
data class User(val id: String, val email: String, val name: String, val roles: List<String> = emptyList()) {
  val isAdmin: Boolean get() = roles.contains("admin")
  override fun toString(): String = "$name <$email>"
}

sealed class ApiError(val status: Int, message: String) : Exception(message) {
  class NotFound(status: Int) : ApiError(status, "not found")
  class RateLimited(status: Int, val retryAfter: Long) : ApiError(status, "rate limited")
  class Server(status: Int) : ApiError(status, "server error")
}

/** A small HTTP client with retries, pagination and a response cache. */
class Client(baseUrl: String, private val token: String? = null, timeoutSeconds: Long = 30, private val retries: Int = 3) {
  private val baseUrl: String = baseUrl.trimEnd('/')
  private val cache = ConcurrentHashMap<String, String>()
  private val http: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(timeoutSeconds)).build()

  companion object {
    private const val USER_AGENT = "scalar-client/1.0"
    private const val BACKOFF_BASE = 0.5
    private const val BACKOFF_FACTOR = 2.0

    fun withDefaults(baseUrl: String, token: String?): Client = Client(baseUrl = baseUrl, token = token)
  }

  fun listUsers(page: Int = 1, perPage: Int = 25, filter: Map<String, String> = emptyMap()): List<User> {
    val query = filter + mapOf("page" to page.toString(), "per_page" to perPage.toString())
    return parseUsers(request(method = "GET", path = "/users", query = query, body = null, attempt = 1))
  }

  fun eachUser(filter: Map<String, String> = emptyMap(), action: (User) -> Unit) {
    var page = 1
    while (true) {
      val batch = listUsers(page = page, perPage = 100, filter = filter)
      if (batch.isEmpty()) return
      batch.forEach(action)
      page += 1
    }
  }

  fun findUser(id: String): User? =
    try {
      parseUsers(cache.computeIfAbsent(id) { key -> request("GET", "/users/$key", emptyMap(), null, 1) }).firstOrNull()
    } catch (error: ApiError.NotFound) {
      null
    }

  fun createUser(email: String, name: String, roles: List<String> = emptyList()): String {
    val encoded = roles.joinToString(separator = ",") { role -> "\"$role\"" }
    val payload = """{"email":"$email","name":"$name","roles":[$encoded]}"""
    return request("POST", "/users", emptyMap(), payload, 1)
  }

  private fun request(method: String, path: String, query: Map<String, String>, body: String?, attempt: Int): String {
    val suffix = if (query.isEmpty()) "" else "?" + query.entries.joinToString("&") { (key, value) -> "$key=$value" }
    val builder = HttpRequest.newBuilder().uri(URI.create("$baseUrl$path$suffix")).header("Accept", "application/json").header("User-Agent", USER_AGENT)
    token?.let { builder.header("Authorization", "Bearer $it") }
    val publisher = if (body == null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)

    val response: HttpResponse<String> = http.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    return when (val status = response.statusCode()) {
      in 200..299 -> response.body()
      404 -> throw ApiError.NotFound(status)
      429 -> {
        if (attempt > retries) throw ApiError.RateLimited(status, 1)
        Thread.sleep((backoffFor(attempt) * 1000).toLong())
        request(method, path, query, body, attempt + 1)
      }
      in 500..599 -> {
        if (attempt > retries) throw ApiError.Server(status)
        Thread.sleep((backoffFor(attempt) * 1000).toLong())
        request(method, path, query, body, attempt + 1)
      }
      else -> throw ApiError.Server(status)
    }
  }

  private fun backoffFor(attempt: Int): Double = BACKOFF_BASE * BACKOFF_FACTOR.pow(attempt - 1)

  private fun parseUsers(body: String): List<User> =
    body.split("},{").filter { chunk -> chunk.isNotBlank() }.map { chunk ->
      User(id = field(chunk, "id"), email = field(chunk, "email"), name = field(chunk, "name"))
    }

  private fun field(chunk: String, name: String): String {
    val at = chunk.indexOf("\"$name\":")
    return if (at < 0) "" else chunk.substring(at + name.length + 4).substringBefore('"')
  }
}
