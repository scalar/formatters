using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Example.Api;

/// <summary>A user as the API returns it.</summary>
public record User(string Id, string Email, string Name, IReadOnlyList<string> Roles)
{
    public bool IsAdmin => Roles.Contains("admin");

    public override string ToString() => $"{Name} <{Email}>";
}

public class ApiException : Exception
{
    public ApiException(int status, string body) : base($"request failed with {status}")
    {
        Status = status;
        Body = body;
    }

    public int Status { get; }

    public string Body { get; }
}

/// <summary>A small HTTP client with retries, pagination and a response cache.</summary>
public sealed class Client : IDisposable
{
    private const string UserAgent = "scalar-client/1.0";
    private const double BackoffBase = 0.5;
    private const double BackoffFactor = 2.0;

    private readonly string _baseUrl;
    private readonly string? _token;
    private readonly int _retries;
    private readonly HttpClient _http;
    private readonly ConcurrentDictionary<string, string> _cache = new();

    public Client(string baseUrl, string? token = null, int timeoutSeconds = 30, int retries = 3)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _token = token;
        _retries = retries;
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(timeoutSeconds) };
    }

    public static Client WithDefaults(string baseUrl, string? token) => new(baseUrl, token);

    public async Task<IReadOnlyList<User>> ListUsersAsync(int page = 1, int perPage = 25, IReadOnlyDictionary<string, string>? filter = null, CancellationToken cancellationToken = default)
    {
        var query = new Dictionary<string, string>(filter ?? new Dictionary<string, string>())
        {
            ["page"] = page.ToString(),
            ["per_page"] = perPage.ToString(),
        };

        var body = await RequestAsync(HttpMethod.Get, "/users", query, null, 1, cancellationToken).ConfigureAwait(false);
        return ParseUsers(body);
    }

    public async IAsyncEnumerable<User> EachUserAsync(IReadOnlyDictionary<string, string>? filter = null)
    {
        var page = 1;
        while (true)
        {
            var batch = await ListUsersAsync(page, 100, filter).ConfigureAwait(false);
            if (batch.Count == 0)
            {
                yield break;
            }

            foreach (var user in batch)
            {
                yield return user;
            }

            page++;
        }
    }

    public async Task<User?> FindUserAsync(string id)
    {
        try
        {
            if (!_cache.TryGetValue(id, out var cached))
            {
                cached = await RequestAsync(HttpMethod.Get, $"/users/{id}", null, null, 1, default).ConfigureAwait(false);
                _cache[id] = cached;
            }

            return ParseUsers(cached).FirstOrDefault();
        }
        catch (ApiException error) when (error.Status == 404)
        {
            return null;
        }
    }

    private async Task<string> RequestAsync(HttpMethod method, string path, IReadOnlyDictionary<string, string>? query, string? body, int attempt, CancellationToken cancellationToken)
    {
        var suffix = query is null || query.Count == 0 ? string.Empty : "?" + string.Join("&", query.Select(pair => $"{pair.Key}={pair.Value}"));
        using var request = new HttpRequestMessage(method, $"{_baseUrl}{path}{suffix}");
        request.Headers.Add("Accept", "application/json");
        request.Headers.Add("User-Agent", UserAgent);

        if (_token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {_token}");
        }

        if (body is not null)
        {
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        }

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        var status = (int)response.StatusCode;

        switch (status)
        {
            case >= 200 and < 300:
                return text;
            case 429 when attempt <= _retries:
            case >= 500 when attempt <= _retries:
                await Task.Delay(TimeSpan.FromSeconds(BackoffFor(attempt)), cancellationToken).ConfigureAwait(false);
                return await RequestAsync(method, path, query, body, attempt + 1, cancellationToken).ConfigureAwait(false);
            default:
                throw new ApiException(status, text);
        }
    }

    private static double BackoffFor(int attempt) => BackoffBase * Math.Pow(BackoffFactor, attempt - 1);

    private static IReadOnlyList<User> ParseUsers(string body) =>
        body.Split("},{", StringSplitOptions.RemoveEmptyEntries)
            .Select(chunk => new User(Field(chunk, "id"), Field(chunk, "email"), Field(chunk, "name"), Array.Empty<string>()))
            .ToList();

    private static string Field(string chunk, string name)
    {
        var at = chunk.IndexOf($"\"{name}\":", StringComparison.Ordinal);
        return at < 0 ? string.Empty : chunk[(at + name.Length + 4)..].Split('"')[0];
    }

    public void Dispose() => _http.Dispose();
}
