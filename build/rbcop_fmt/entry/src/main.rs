//! `rubocop --autocorrect --only Layout` over one file, through rbcop's library.
//!
//! argv: `<config.yml> <input.rb>`. The corrected source goes to stdout; an
//! error goes to stderr with exit status 1.
//!
//! This is the same pass `packages/ruby` runs today through RuboCop on CRuby:
//! the Layout department only, with `-a` (safe) autocorrection, against one
//! config file. It calls rbcop's library rather than its CLI because the CLI
//! carries a result cache, an LSP and an MCP server that a formatter never
//! reaches and that do not build for wasm32-wasip1.
use rbcop::autocorrect::{Mode, correct_bytes};
use rbcop::config::{Options, Store};
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        fail("usage: rbcop_fmt <config.yml> <input.rb>");
    }
    let (config, input) = (PathBuf::from(&args[1]), PathBuf::from(&args[2]));

    // As rbcop's own main builds it: every implemented cop, plus Lint/Syntax,
    // which lives in the runner but has its own config entry.
    let names: Vec<&'static str> = rbcop::cops::ALL.iter().map(|c| c.name).chain(["Lint/Syntax"]).collect();
    let opts = Options { config_file: Some(config), only: vec!["Layout".into()], ..Default::default() };
    let mut store = Store::new(opts, names).unwrap_or_else(|e| fail(&e));
    let dir = input.parent().map(PathBuf::from).unwrap_or_default();
    let cfg = store.for_dir(&dir).unwrap_or_else(|e| fail(&e));

    let bytes = std::fs::read(&input).unwrap_or_else(|e| fail(&e.to_string()));
    let original = bytes.clone();
    let selected = |cop: &str| cop.starts_with("Layout/");
    let out = correct_bytes(&input, "input.rb", bytes, &cfg, &selected, Mode::Safe);
    if let Some(e) = out.error {
        fail(&format!("{e:?}"));
    }

    // No corrections means no new source: the input was already clean.
    let text = out.source.unwrap_or_else(|| String::from_utf8(original).unwrap_or_else(|e| fail(&e.to_string())));
    print!("{text}");
}

fn fail(msg: &str) -> ! {
    eprintln!("{msg}");
    std::process::exit(1)
}
