# frozen_string_literal: true
module Scalar
  class Client
    DEFAULT_TIMEOUT=30
    attr_reader :base_url
    def initialize(base_url:, token: nil, timeout: DEFAULT_TIMEOUT)
      @base_url=base_url; @token=token; @timeout=timeout
    end
    def list_users(page: 1, per_page: 25, filter: {})
      get("/users", query: { page: page, per_page: per_page }.merge(filter))
    end
  end
end
