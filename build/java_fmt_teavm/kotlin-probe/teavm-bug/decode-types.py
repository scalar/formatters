#!/usr/bin/env python3
"""Name the types or functions a WasmGC error refers to.

V8 reports a type mismatch as bare indices - "expected (ref null 820), got
(ref null 710)" - which says nothing about what went wrong, and a trap as
"wasm-function[47]", which says just as little. TeaVM writes a name section, so
the indices can be resolved back to Java classes and methods.

    ./decode-types.py    <classes.wasm> 820 710      # types
    ./decode-types.py -f <classes.wasm> 47 183       # functions

Both need a module built with minifying=false; TeaVM writes no name section
otherwise.
"""
import sys


def leb(data, i, signed=False):
    result = shift = 0
    while True:
        byte = data[i]
        i += 1
        result |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            if signed and byte & 0x40:
                result -= 1 << shift
            return result, i


def name(data, i):
    length, i = leb(data, i)
    return data[i:i + length].decode('utf-8', 'replace'), i + length


def name_map(data, i, end):
    """A vector of (index, name), used for functions, types and globals alike."""
    out = {}
    count, i = leb(data, i)
    for _ in range(count):
        if i >= end:
            break
        index, i = leb(data, i)
        text, i = name(data, i)
        out[index] = text
    return out


def parse(path):
    data = open(path, 'rb').read()
    assert data[:4] == b'\0asm', 'not a wasm module'
    i, names = 8, {}
    while i < len(data):
        section_id, i = leb(data, i)
        size, i = leb(data, i)
        end = i + size
        if section_id == 0:
            section_name, j = name(data, i)
            if section_name == 'name':
                while j < end:
                    sub_id, j = leb(data, j)
                    sub_size, j = leb(data, j)
                    sub_end = j + sub_size
                    # 1 = functions, 4 = types, 7 = globals; same encoding, and
                    # only the type map is needed here.
                    if sub_id in (1, 4, 7):
                        names.setdefault(sub_id, {}).update(name_map(data, j, sub_end))
                    j = sub_end
        i = end
    return names


def main():
    args = sys.argv[1:]
    sub_id, label = 4, 'types'
    if args and args[0] == '-f':
        sub_id, label = 1, 'functions'
        args = args[1:]
    if len(args) < 2:
        print(__doc__.strip())
        return 1
    entries = parse(args[0]).get(sub_id, {})
    if not entries:
        print(f'no {label[:-1]} names in this module - was it built with minifying=false?')
        return 1
    print(f'{len(entries)} named {label}')
    for arg in args[1:]:
        index = int(arg)
        print(f'  {index}: {entries.get(index, "<unnamed>")}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
