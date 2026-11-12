# The spelling dictionary's word list (docs/displaywriter/architecture.md 12.3, docs/assets.md):
#   python3 tools/wp/build_wordlist.py <12dicts-6.0.2 directory>   -> public/assets/wordlist_en.gz.bin
# Source: Alan Beale's 12dicts 6.0.2 (wordlist.sourceforge.net, 12dicts-6.0.2.zip), whose lists he released to the
# public domain except 2of12inf and the 2+2+3 lists, which are not used here. Taken: International/3of6all.txt
# (inflected forms, British and American spellings) and American/2of12.txt.
#
# Kept: words of letters with an inner apostrophe (isn't, o'clock); a capitalised word stays capitalised (Monday).
# Dropped: abbreviations in capitals (ABC, FIFO), the single letters but a, I and O, entries with digits, periods,
# slashes or spaces, affixes (-ness, 's). A hyphenated entry is not kept whole: its parts are, since the checker
# checks the parts of a hyphenated word one at a time.
#
# Format: gzip (level 9, no timestamp) of Latin-1 text. Line 1: `wordlist <count> <source>`. Then the words in
# code-unit order, front-coded: each line is one character, chr(0x30 + n), for the n leading characters shared with
# the previous word, then the rest of the word.
import gzip, os, re, sys

ANNOTATION = re.compile(r'[$+!:=<>^~#&%*]+$')
WORD = re.compile(r"[A-Za-z][a-z]*(?:'[a-z]+)?")


def entries(path):
    with open(path, encoding='latin-1') as f:
        for line in f:
            w = ANNOTATION.sub('', line.strip())
            if w:
                yield w


def keep(w):
    if w in ('a', 'I', 'O'):
        return True
    return len(w) > 1 and WORD.fullmatch(w) is not None


def main(root, out='public/assets/wordlist_en.gz.bin'):
    words = set()
    for rel in ('International/3of6all.txt', 'American/2of12.txt'):
        for w in entries(os.path.join(root, rel)):
            if ' ' in w:
                continue
            for part in (w.split('-') if '-' in w.strip('-') else [w]):
                if keep(part):
                    words.add(part)
    ordered = sorted(words)
    lines = [f'wordlist {len(ordered)} 12dicts-6.0.2']
    prev = ''
    for w in ordered:
        n = 0
        while n < min(len(prev), len(w), 40) and prev[n] == w[n]:
            n += 1
        lines.append(chr(0x30 + n) + w[n:])
        prev = w
    data = gzip.compress(('\n'.join(lines) + '\n').encode('latin-1'), 9, mtime=0)
    with open(out, 'wb') as f:
        f.write(data)
    print(f'{out}: {len(ordered)} words, {len(data)} bytes')


if __name__ == '__main__':
    main(*sys.argv[1:])
