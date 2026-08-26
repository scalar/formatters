# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

module Scalar
  module Api
    class Error < StandardError
      attr_reader :status, :body
      def initialize(status, body)
        @status = status
        @body = body
        super("request failed with #{status}")
      end
    end

    class NotFoundError < Error; end
    class RateLimitedError < Error
      def retry_after = body.fetch("retry_after", 1).to_i
    end

    # A small HTTP client with retries, pagination and a response cache.
    class Client
      DEFAULT_TIMEOUT = 30
      DEFAULT_RETRIES = 3
      BACKOFF = { base: 0.5, factor: 2.0, jitter: 0.1 }.freeze
      USER_AGENT = "scalar-client/1.0"

      attr_reader :base_url, :timeout, :retries

      def initialize(base_url:, token: nil, timeout: DEFAULT_TIMEOUT, retries: DEFAULT_RETRIES, logger: nil)
        @base_url = base_url.to_s.chomp("/")
        @token = token
        @timeout = timeout
        @retries = retries
        @logger = logger
        @cache = {}
        @mutex = Mutex.new
      end

      def list_users(page: 1, per_page: 25, filter: {}, &block)
        query = { page: page, per_page: per_page }.merge(filter).reject { |_, v| v.nil? }
        response = get("/users", query: query)
        users = response.fetch("data", []).map { |attrs| User.new(**attrs.transform_keys(&:to_sym)) }
        return users unless block_given?
        users.each(&block)
      end

      def each_user(filter: {})
        return enum_for(:each_user, filter: filter) unless block_given?

        page = 1
        loop do
          batch = list_users(page: page, per_page: 100, filter: filter)
          break if batch.empty?
          batch.each { |user| yield user }
          page += 1
        end
      end

      def find_user(id)
        cached(id) { get("/users/#{id}") }
      rescue NotFoundError
        nil
      end

      def create_user(email:, name:, roles: [], **extra)
        post("/users", body: { email: email, name: name, roles: roles, **extra })
      end

      private

      def cached(key)
        @mutex.synchronize do
          return @cache[key] if @cache.key?(key)
          @cache[key] = yield
        end
      end

      def get(path, query: {})
        request(Net::HTTP::Get, path, query: query)
      end

      def post(path, body:, query: {})
        request(Net::HTTP::Post, path, query: query, body: body)
      end

      def request(verb, path, query: {}, body: nil, attempt: 1)
        uri = URI.join(base_url, path)
        uri.query = URI.encode_www_form(query) unless query.empty?
        req = verb.new(uri)
        req["Accept"] = "application/json"
        req["User-Agent"] = USER_AGENT
        req["Authorization"] = "Bearer #{@token}" if @token
        req.body = JSON.generate(body) if body

        response = perform(req, uri)
        handle(response, verb, path, query, body, attempt)
      rescue Net::OpenTimeout, Net::ReadTimeout => e
        raise e if attempt > retries
        sleep(backoff_for(attempt))
        request(verb, path, query: query, body: body, attempt: attempt + 1)
      end

      def perform(req, uri)
        Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", read_timeout: timeout) do |http|
          http.request(req)
        end
      end

      def handle(response, verb, path, query, body, attempt)
        payload = response.body.to_s.empty? ? {} : JSON.parse(response.body)

        case response.code.to_i
        when 200..299 then payload
        when 404 then raise NotFoundError.new(404, payload)
        when 429
          error = RateLimitedError.new(429, payload)
          raise error if attempt > retries
          @logger&.warn(format("rate limited, sleeping %.2fs", error.retry_after))
          sleep(error.retry_after)
          request(verb, path, query: query, body: body, attempt: attempt + 1)
        when 500..599
          raise Error.new(response.code.to_i, payload) if attempt > retries
          sleep(backoff_for(attempt))
          request(verb, path, query: query, body: body, attempt: attempt + 1)
        else raise Error.new(response.code.to_i, payload)
        end
      end

      def backoff_for(attempt)
        BACKOFF[:base] * (BACKOFF[:factor]**(attempt - 1)) + (rand * BACKOFF[:jitter])
      end
    end

    User = Struct.new(:id, :email, :name, :roles, keyword_init: true) do
      def admin? = Array(roles).include?("admin")
      def to_h = { id: id, email: email, name: name, roles: Array(roles) }
      def to_s = "#{name} <#{email}>"
    end

    def self.usage
      puts <<~TEXT
        Usage: client [options]
          -u, --url URL      base url
          -t, --token TOKEN  bearer token
          -v, --verbose      log every request
      TEXT
    end
  end
end
