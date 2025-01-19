# _Worm_ Scraper Substitutions Files

These files contain per-chapter fixes to improve lines of text. They are in a custom file format, whose parser can be found in [`convert.js`](../lib/convert.js).

## Basic format

An example of the basic format is:

```
@ https://parahumans.wordpress.com/2011/06/14/gestation-1-2/
  - each others houses
  + each others’ houses

  - x-acto
  + X-Acto


@ https://parahumans.wordpress.com/2011/06/18/gestation-1-3/
  - top 5
  + top five

  - East end
  + east end
```

Each chapter, denoted by its URL, gets a section, via a line starting with `@ `. Indented by two spaces underneath each chapter are pairs of `- ` and `+ ` lines, representing the text to replace and the replacement.

## Newlines and trailing spaces

Newlines can be included by including the literal string `\n`:

```
  - <p><em>Crazed, kooky, cracked, crazy</em>, <br />\n<em>Nutty, barmy, mad for me…</em></p>
  + <p><i>Crazed, kooky, cracked, crazy,<br />\nNutty, barmy, mad for me…</i></p>
```

Since sometimes we need to replace lines with trailing spaces, which don't show up easily when editing, any number of `\s` strings at the end of the line can be used to denote such trailing spaces:

```
  - MWBB <em>
  + <em>MWBB\s
```

There is no ability to escape these escape sequences right now, since it is not needed.

## Regular expressions

If a chapter needs a specific regular expression applied to its contents, use `r ` and `s ` line pairs:

```
  r </em><br />\n<em>\s*
  s </em></p>\n<p style="padding-left: 30px;"><em>
```

## Comments

Comment lines can appear at any point under each chapter, starting with `# `.

```
  - see the Doctor
  + see the doctor
  # Unlike the Cauldron Doctor, this is not used as a proper noun
```
