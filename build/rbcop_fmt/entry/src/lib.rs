//! `rubocop --autocorrect --only Layout` over one source, through rbcop's
//! library, as a WASI reactor.
//!
//! The JavaScript side instantiates this once and calls `rbcop_correct` per
//! format. It is a reactor rather than a command so that the parsed config
//! survives between calls: resolving a config merges it over RuboCop's own
//! ~600-cop default.yml, which costs ~30ms, while the Layout pass on a typical
//! file costs ~4ms.
//!
//! The calling convention is deliberately small:
//!
//! 1. `rbcop_alloc` twice, for the source and the config, and copy both in.
//! 2. `rbcop_correct(source, source_len, config, config_len)` returns 0 when
//!    the result is corrected source and 1 when it is an error message. It
//!    takes ownership of both buffers and frees them.
//! 3. `rbcop_result_ptr` and `rbcop_result_len` locate the result, which stays
//!    valid until the next `rbcop_correct`.
//!
//! The config arrives as text and is written into the preopened `/work`
//! directory, because rbcop reads configuration the way RuboCop does: from a
//! file, so that `inherit_from` and relative `Include`/`Exclude` patterns
//! resolve against where it lives. One file per distinct config text, so a
//! cached config can never answer for different settings.
use rbcop::autocorrect::{Mode, correct_bytes};
use rbcop::config::{Options, Resolved, Store};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// The preopened directory the host gives this module. It holds the config
/// files; the source never touches it.
const WORK_DIR: &str = "/work";

/// The path offenses are reported against. Nothing is read from or written to
/// it: the source travels in and out through memory. It is under `WORK_DIR` so
/// that the config's `Include` and `Exclude` patterns, which resolve relative to
/// the config file, treat it as an ordinary project file.
const INPUT_PATH: &str = "/work/input.rb";

/// What `rbcop_correct` returns.
const OK: u32 = 0;
const ERROR: u32 = 1;

/// A resolved config, kept with the store that resolved it.
struct Loaded {
    _store: Store,
    config: Arc<Resolved>,
}

thread_local! {
    static CONFIGS: RefCell<HashMap<String, Loaded>> = RefCell::new(HashMap::new());
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Allocates `len` bytes for the host to write into.
#[unsafe(no_mangle)]
pub extern "C" fn rbcop_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// Where the last result starts.
#[unsafe(no_mangle)]
pub extern "C" fn rbcop_result_ptr() -> *const u8 {
    RESULT.with_borrow(|result| result.as_ptr())
}

/// How long the last result is, in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn rbcop_result_len() -> usize {
    RESULT.with_borrow(|result| result.len())
}

/// Corrects every Layout offense in the source and stores the result.
///
/// # Safety
///
/// Both pointers must come from `rbcop_alloc` with the lengths given, and must
/// not be used again afterwards: this takes ownership of them.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rbcop_correct(source: *mut u8, source_len: usize, config: *mut u8, config_len: usize) -> u32 {
    // SAFETY: the caller hands over two buffers from rbcop_alloc, initialized
    // up to the lengths given.
    let (source, config) = unsafe {
        (Vec::from_raw_parts(source, source_len, source_len), Vec::from_raw_parts(config, config_len, config_len))
    };

    let (status, bytes) = match correct(source, config) {
        Ok(text) => (OK, text.into_bytes()),
        Err(message) => (ERROR, message.into_bytes()),
    };
    RESULT.set(bytes);
    status
}

fn correct(source: Vec<u8>, config: Vec<u8>) -> Result<String, String> {
    let config = String::from_utf8(config).map_err(|_| "the RuboCop config is not valid UTF-8".to_string())?;

    // Source that does not parse is refused before RuboCop sees it. RuboCop
    // reports it as a Lint/Syntax offense and corrects nothing, so without this
    // the input would come back unchanged and fail the output check below,
    // which blames the pass for a problem that was in the input all along.
    if let Some(error) = ruby_prism::parse(&source).errors().next() {
        let offset = error.location().start_offset();
        let line = 1 + source[..offset.min(source.len())].iter().filter(|&&byte| byte == b'\n').count();
        return Err(format!("the source is not valid Ruby, so it was not formatted: line {line}: {}", error.message()));
    }

    let resolved = resolve(&config)?;

    let input = Path::new(INPUT_PATH);
    let selected = |cop: &str| cop.starts_with("Layout/");
    let corrected = correct_bytes(input, "input.rb", source.clone(), &resolved, &selected, Mode::Safe);

    if let Some(error) = corrected.error {
        return Err(format!(
            "the RuboCop pass could not settle, so nothing was returned for this source: {error}"
        ));
    }
    if let Some(abort) = corrected.report.abort {
        return Err(format!("the RuboCop pass stopped on this source: {abort}"));
    }

    // No new source means nothing was corrected: the input was already clean.
    let text = match corrected.source {
        Some(text) => text,
        None => String::from_utf8(source).map_err(|_| "the source is not valid UTF-8".to_string())?,
    };

    // Never hand back Ruby that Ruby cannot read. RuboCop re-parses after every round and would report a
    // correction that broke the syntax as Lint/Syntax, not refuse it, so the
    // check is made here, with the parser rbcop itself runs on.
    if ruby_prism::parse(text.as_bytes()).errors().next().is_some() {
        return Err("the RuboCop pass produced source that Ruby cannot parse, so it was discarded rather than \
                    returned - please report this"
            .to_string());
    }

    Ok(text)
}

/// The resolved config for one config text, built at most once per text.
fn resolve(config: &str) -> Result<Arc<Resolved>, String> {
    if let Some(resolved) = CONFIGS.with_borrow(|configs| configs.get(config).map(|loaded| loaded.config.clone())) {
        return Ok(resolved);
    }

    let index = CONFIGS.with_borrow(HashMap::len);
    let path = PathBuf::from(format!("{WORK_DIR}/rubocop-{index}.yml"));
    std::fs::write(&path, config).map_err(|e| format!("could not write the RuboCop config into {WORK_DIR}: {e}"))?;

    // As rbcop's own main builds it: every implemented cop, plus Lint/Syntax,
    // which lives in the runner but has its own config entry.
    let names: Vec<&'static str> = rbcop::cops::ALL.iter().map(|c| c.name).chain(["Lint/Syntax"]).collect();
    let options = Options { config_file: Some(path), only: vec!["Layout".into()], ..Default::default() };
    let mut store = Store::new(options, names)?;
    let resolved = store.for_dir(Path::new(WORK_DIR))?;

    // ERB and remote `inherit_from` are rendered by running Ruby, and there is
    // none here. rbcop warns and carries on without them, which would quietly
    // give a different answer from the RuboCop the config was written for, so
    // here it is an error instead.
    let needs_ruby: Vec<&String> = store.warnings.iter().filter(|w| w.contains("needs ruby")).collect();
    if !needs_ruby.is_empty() {
        let reasons = needs_ruby.iter().map(|w| w.as_str()).collect::<Vec<_>>().join("; ");
        return Err(format!(
            "the RuboCop config asks for something only a Ruby can do, and the pass has none: {reasons}"
        ));
    }

    CONFIGS.with_borrow_mut(|configs| {
        configs.insert(config.to_string(), Loaded { _store: store, config: resolved.clone() });
    });
    Ok(resolved)
}
