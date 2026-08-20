# frozen_string_literal: true

# Keeps the prism *gem* out of the wasm bundle, because CRuby already has prism
# inside it.
#
# rubocop-ast depends on `prism ~> 1.7` and subclasses `Prism::Translation::
# Parser::Builder` while it is being required, so prism has to be loadable
# before the first cop is registered - it is not optional the way an unused
# parser engine would be. The Layout pass never actually parses with it: the
# `parser_engine` stays whitequark, which is what the conformance test compares
# against.
#
# The gem cannot supply it. rbwasm builds a C extension for every bundled gem
# that has one, and it generates the extension Makefile itself rather than
# running the gem's extconf.rb - the same thing that defeats the json gem next
# door. prism's extension is not a small one, and there is no reason to build
# it: CRuby 4.0.0 has prism compiled in already, as `Prism` the constant and
# `prism/prism` in the built-in extension table. A static wasm build resolves
# that table before $LOAD_PATH, so a gem's Ruby files would end up driving the
# built-in C extension anyway, at whatever version skew happened to exist.
#
# So this gemspec tells Bundler the requirement is met and ships nothing: it
# declares no files, so the bundle gets no prism directory, rbwasm skips a
# require path that does not exist on disk, and `require "prism"` in the guest
# falls through to the default gem. build.sh has to keep prism's Ruby files in
# the install tree for that to work - it used to strip them, back when nothing
# loaded prism at all. (RubyGems insists on at least one require path, so `lib`
# is named here - there is no such directory.)
#
# The version tracks whatever Ruby ships. Check it after a Ruby bump with:
#
#   ruby -e 'require "prism"; puts Prism::VERSION'   # inside the artifact
Gem::Specification.new do |spec|
  spec.name = "prism"
  spec.version = "1.7.0"
  spec.summary = "Placeholder for the prism default gem already inside CRuby"
  spec.authors = ["Scalar"]
  spec.license = "MIT"
  spec.files = []
  spec.require_paths = ["lib"]
end
