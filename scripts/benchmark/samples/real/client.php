<?php

declare(strict_types=1);

namespace App\Service;

use App\Repository\UserRepository;
use Psr\Log\LoggerInterface;
use RuntimeException;

/**
 * A user as the API returns it.
 */
final class User
{
    public function __construct(
        public readonly int $id,
        public readonly string $email,
        public readonly string $name,
        public readonly array $roles = []
    ) {
    }

    public function isAdmin(): bool
    {
        return in_array('admin', $this->roles, true);
    }

    public function __toString(): string
    {
        return sprintf('%s <%s>', $this->name, $this->email);
    }
}

enum Status: int
{
    case Ok = 200;
    case NotFound = 404;
    case RateLimited = 429;
    case ServerError = 500;

    public function isRetryable(): bool
    {
        return match ($this) {
            Status::RateLimited, Status::ServerError => true,
            default => false,
        };
    }
}

class ApiException extends RuntimeException
{
    public function __construct(private readonly int $status, private readonly string $body)
    {
        parent::__construct("request failed with {$status}");
    }

    public function status(): int
    {
        return $this->status;
    }

    public function body(): string
    {
        return $this->body;
    }
}

/**
 * A small API client with retries, pagination and a response cache.
 */
final class UserService implements \Countable
{
    private const DEFAULT_LIMIT = 25;
    private const BACKOFF_BASE = 0.5;
    private const BACKOFF_FACTOR = 2.0;

    /** @var array<int, User> */
    private array $cache = [];

    public function __construct(
        private readonly UserRepository $users,
        private readonly int $retries = 3,
        private readonly ?LoggerInterface $log = null
    ) {
    }

    public function count(): int
    {
        return count($this->cache);
    }

    /**
     * @param array<string, mixed> $filter
     * @return array<int, User>
     */
    public function listUsers(int $page = 1, int $perPage = self::DEFAULT_LIMIT, array $filter = []): array
    {
        $query = array_filter(array_merge($filter, ['page' => $page, 'per_page' => $perPage]), static fn ($value) => $value !== null);
        $rows = $this->request('GET', '/users', $query, null, 1);

        return array_map(
            static fn (array $row): User => new User($row['id'], $row['email'], $row['name'], $row['roles'] ?? []),
            $rows
        );
    }

    /**
     * @param array<string, mixed> $filter
     * @return \Generator<int, User>
     */
    public function eachUser(array $filter = []): \Generator
    {
        $page = 1;
        while (true) {
            $batch = $this->listUsers($page, 100, $filter);
            if ($batch === []) {
                return;
            }

            foreach ($batch as $user) {
                yield $user;
            }

            ++$page;
        }
    }

    public function findUser(int $id): ?User
    {
        if (isset($this->cache[$id])) {
            return $this->cache[$id];
        }

        try {
            $rows = $this->request('GET', "/users/{$id}", [], null, 1);
        } catch (ApiException $error) {
            if ($error->status() === Status::NotFound->value) {
                return null;
            }

            throw $error;
        }

        $row = $rows[0] ?? null;

        return $this->cache[$id] = $row === null ? null : new User($row['id'], $row['email'], $row['name'], $row['roles'] ?? []);
    }

    /**
     * @param array<string, mixed> $query
     * @return array<int, array<string, mixed>>
     */
    private function request(string $method, string $path, array $query, ?string $body, int $attempt): array
    {
        $suffix = $query === [] ? '' : '?' . http_build_query($query);
        $response = $this->users->send($method, $path . $suffix, $body);
        $status = Status::tryFrom((int) ($response['status'] ?? 500));

        if ($status === Status::Ok) {
            return $response['data'] ?? [];
        }

        if ($status !== null && $status->isRetryable() && $attempt <= $this->retries) {
            $this->log?->warning(sprintf('retrying %s %s after %.2fs', $method, $path, $this->backoffFor($attempt)));
            usleep((int) ($this->backoffFor($attempt) * 1_000_000));

            return $this->request($method, $path, $query, $body, $attempt + 1);
        }

        throw new ApiException((int) ($response['status'] ?? 500), (string) ($response['body'] ?? ''));
    }

    private function backoffFor(int $attempt): float
    {
        return self::BACKOFF_BASE * (self::BACKOFF_FACTOR ** ($attempt - 1));
    }
}
