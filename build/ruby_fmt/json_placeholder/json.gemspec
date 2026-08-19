# frozen_string_literal: true

# Keeps the json *gem* out of the wasm bundle, because CRuby already has json
# inside it.
#
# RuboCop depends on `json ~> 2.3`, so Bundler resolves one, and rbwasm builds a
# C extension for every bundled gem that has one. json's does not survive that:
# rbwasm generates the extension Makefile itself rather than running the gem's
# extconf.rb, so none of the `HAVE_*` macros extconf would have defined are set,
# and every `#ifndef HAVE_...` compatibility shim in json's parser collides with
# the declaration it was meant to stand in for:
#
#   parser.rl:419:15: error: static declaration of 'strnlen' follows non-static
#   declaration
#
# That is not specific to a version - every json release carries those shims -
# so there is no pin that fixes it.
#
# There is also nothing to fix. json 2.9.1 is a *default gem* of Ruby 3.4.1, so
# it is already compiled into the artifact, Ruby files and C extension both.
# This gemspec tells Bundler that requirement is met and ships nothing: it
# declares no files, so the bundle gets no json directory at all: rbwasm skips a
# require path that does not exist on disk, `require "json"` in the guest falls
# through to the built-in default gem, and what RuboCop loads is the real json
# rather than a second copy shadowing it. (RubyGems insists on at least one
# require path, so `lib` is named here - there is no such directory.)
#
# The version tracks whatever Ruby ships. Check it after a Ruby bump with:
#
#   ruby -e 'require "json"; puts JSON::VERSION'   # inside the artifact
Gem::Specification.new do |spec|
  spec.name = "json"
  spec.version = "2.9.1"
  spec.summary = "Placeholder for the json default gem already inside CRuby"
  spec.authors = ["Scalar"]
  spec.license = "Ruby"
  spec.files = []
  spec.require_paths = ["lib"]
end
