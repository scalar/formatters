//! ktrs's ktfmt-identical formatter as a wasm module, for `@scalar/kotlin-fmt`.
//!
//! The boundary is plain exports and integers, with no bindgen layer: the host
//! encodes UTF-8 source into a buffer from [`kotlin_fmt_alloc`], calls
//! [`kotlin_fmt_format`] with it and the options, and reads the result through
//! [`kotlin_fmt_result_ptr`] and [`kotlin_fmt_result_len`]. The result stays
//! owned by the module until the next format replaces it, so the host never
//! frees anything.
//!
//! Options cross as integers rather than an encoded string, with a negative
//! value meaning "whatever the chosen style says". That keeps ktrs's presets
//! authoritative - this file never restates one of ktfmt's defaults - and
//! leaves nothing to parse on this side.

use std::cell::RefCell;

use ktrs_fmt::{
    FileType, FormattingOptions, GOOGLE_FORMAT, KOTLINLANG_FORMAT, META_FORMAT, TrailingCommaManagementStrategy,
};

/// What [`kotlin_fmt_format`] returns when the result is formatted source.
const OK: u32 = 0;
/// What it returns when the result is ktfmt's error message instead.
const ERROR: u32 = 1;

thread_local! {
    /// The last result, kept until the next call so the host can read it.
    static RESULT: RefCell<String> = const { RefCell::new(String::new()) };
}

/// A buffer of exactly `len` bytes for the host to fill, handed back to
/// [`kotlin_fmt_format`], which takes ownership of it.
///
/// A boxed slice rather than `Vec::with_capacity`, whose capacity is only
/// promised to be *at least* `len`: freeing it later needs the exact size it
/// was allocated with, and a boxed slice's length is that size by definition.
#[unsafe(no_mangle)]
pub extern "C" fn kotlin_fmt_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast::<u8>()
}

/// Formats the first `len` bytes of the `capacity`-byte buffer at `source`,
/// freeing it, and returns [`OK`] or
/// [`ERROR`]. The result - formatted source or the error message - is read
/// through [`kotlin_fmt_result_ptr`] and [`kotlin_fmt_result_len`].
///
/// `style` is 0 for meta, 1 for google and 2 for kotlinlang. Each later
/// argument overrides the style when it is not negative: `trailing_commas` is
/// 0 none, 1 only add, 2 complete, and the two flags are 0 or 1.
///
/// The two sizes differ because the host encodes straight into the buffer:
/// it asks for the most bytes the source could take as UTF-8 and only learns
/// how many it used afterwards. The buffer is freed at `capacity`, the size it
/// was allocated with.
///
/// # Safety
/// `source` must be a buffer from [`kotlin_fmt_alloc`]`(capacity)`, and
/// `len <= capacity`.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn kotlin_fmt_format(
    source: *mut u8,
    capacity: usize,
    len: usize,
    style: u32,
    max_width: i32,
    block_indent: i32,
    continuation_indent: i32,
    trailing_commas: i32,
    remove_unused_imports: i32,
    preserve_lambda_breaks: i32,
) -> u32 {
    let mut input: Vec<u8> = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(source, capacity)) }.into_vec();
    input.truncate(len);
    let options = Options {
        style,
        max_width,
        block_indent,
        continuation_indent,
        trailing_commas,
        remove_unused_imports,
        preserve_lambda_breaks,
    };

    let (status, text) = match String::from_utf8(input) {
        Ok(code) => format_code(&code, &options.resolve()),
        // The host encodes with TextEncoder, which never produces invalid
        // UTF-8, so this is a broken caller rather than a broken source.
        Err(error) => (ERROR, format!("source is not valid UTF-8: {error}")),
    };

    RESULT.with(|result| *result.borrow_mut() = text);
    status
}

/// Where the last result starts in linear memory.
#[unsafe(no_mangle)]
pub extern "C" fn kotlin_fmt_result_ptr() -> *const u8 {
    RESULT.with(|result| result.borrow().as_ptr())
}

/// The last result's length in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn kotlin_fmt_result_len() -> usize {
    RESULT.with(|result| result.borrow().len())
}

/// The arguments of one call, before they are laid over a preset.
struct Options {
    style: u32,
    max_width: i32,
    block_indent: i32,
    continuation_indent: i32,
    trailing_commas: i32,
    remove_unused_imports: i32,
    preserve_lambda_breaks: i32,
}

impl Options {
    /// The chosen preset with every non-negative argument laid over it.
    fn resolve(&self) -> FormattingOptions {
        let mut options = match self.style {
            1 => GOOGLE_FORMAT,
            2 => KOTLINLANG_FORMAT,
            // ktfmt's own default: "If none of the style options are passed,
            // Meta's style is used."
            _ => META_FORMAT,
        };

        if self.max_width >= 0 {
            options.max_width = self.max_width;
        }
        if self.block_indent >= 0 {
            options.block_indent = self.block_indent;
        }
        if self.continuation_indent >= 0 {
            options.continuation_indent = self.continuation_indent;
        }
        match self.trailing_commas {
            0 => options.trailing_comma_management_strategy = TrailingCommaManagementStrategy::None,
            1 => options.trailing_comma_management_strategy = TrailingCommaManagementStrategy::OnlyAdd,
            2 => options.trailing_comma_management_strategy = TrailingCommaManagementStrategy::Complete,
            _ => {}
        }
        if self.remove_unused_imports >= 0 {
            options.remove_unused_imports = self.remove_unused_imports != 0;
        }
        if self.preserve_lambda_breaks >= 0 {
            options.preserve_lambda_breaks = self.preserve_lambda_breaks != 0;
        }

        options
    }
}

/// The status and the formatted source or ktfmt's error message.
///
/// Parsed as a script, which is how ktfmt's CLI parses stdin - the one input
/// with no file name to take a type from. A script accepts everything a `.kt`
/// file does and top-level statements besides, so no valid source is refused.
/// A leading byte-order mark is dropped, as the CLI drops it.
fn format_code(code: &str, options: &FormattingOptions) -> (u32, String) {
    let code = code.strip_prefix('\u{feff}').unwrap_or(code);
    match ktrs_fmt::format(code, FileType::Script, options) {
        Ok(formatted) => (OK, formatted),
        Err(error) => (ERROR, error.to_string()),
    }
}
