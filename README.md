# _Worm_ Scraper

Scrapes the web serial [_Worm_](https://parahumans.wordpress.com/), its sequel [_Ward_](https://www.parahumans.net/), and the bridge series [_Glow-worm_](https://www.parahumans.net/2017/10/21/glow-worm-0-1/) into an ebook format.

## How to use

First you'll need a modern version of [Node.js](https://nodejs.org/en/). The earliest version tested is v20.16.0.

Then, open a terminal ([Mac documentation](http://blog.teamtreehouse.com/introduction-to-the-mac-os-x-command-line), [Windows documentation](http://www.howtogeek.com/235101/10-ways-to-open-the-command-prompt-in-windows-10/)) and install the program by typing

```bash
npm install -g worm-scraper
```

This will take a while as it downloads this program and its dependencies from the internet. Once it's done, try to run it, by typing:

```bash
worm-scraper --help
```

If this outputs some help documentation, then the installation process went smoothly. You can move on to assemble the ebook by typing

```bash
worm-scraper
```

This will take a while, but will eventually produce a `Worm.epub` file!

If you'd like to get _Ward_ instead of _Worm_, use `--book=ward`, e.g.

```bash
worm-scraper --book=ward
```

Similarly, for _Glow-worm_:

```bash
worm-scraper --book=glow-worm
```

## Reading EPUBs on Amazon Kindle

EPUBs are not the native format for Amazon Kindle devices and apps. However, you can send them to your Kindle library by following [Amazon's instructions](https://www.amazon.com/gp/help/customer/display.html?nodeId=G5WYD9SAF7PGXRNA).

## Chapter titles

The original chapter titles, i.e. the ones that appear as heading at the top of each chapter published online, are not very book-like. They vary wildly, e.g. "Gestation 1.1", "Daybreak – 1.2", "Interlude 1", "Flare – Interlude 2", "Interlude 10.y", "Interlude 10.5 (Bonus)", "Interlude 14.5 (Bonus Interlude)".

By default, `worm-scraper` simplifies the titles to be just numbers ("1", "2", "3"), with interludes denoted via Roman numerals ("Interlude I", "Interlude II", ...)—or left as simply "Interlude" if an arc contains a single interlude.

If you want the original chapter titles, you can pass the following option:

```bash
worm-scraper --chapter-titles=original
```

There's a third option, which is to have the interludes (and _Ward_'s epilogues) include character names. Samples of this format include "Interlude: Danny" or "Interlude: Armsmaster". Use

```bash
worm-scraper --chapter-titles=character-names
```

for this. _This can be a slight spoiler_, because the reading experience of many interludes relies on you gradually discovering who the main character is and how they relate to what you've seen before. It can also spoil you on which characters survive, if you look ahead in the table of contents.

This style is _sort of_ aligned with how the interludes are presented in the table of contents [for _Worm_](https://parahumans.wordpress.com/table-of-contents/) and [for _Ward_](https://www.parahumans.net/table-of-contents/). But even those are inconsistent, and `worm-scraper` departs from the table of contents names in several cases. `worm-scraper` generally tries to pick the name name by which the character is first referred to in the chapter, to minimize the spoiler effect, but sometimes takes influence from the original tables of contents, or the names chosen by [the Fandom wiki](https://worm.fandom.com/wiki/Chapter_List).

You can see all the chosen character-name titles in the [`chapter-data/`](./chapter-data/) directory's files. If you strongly disagree with a choice made, please file an issue.

## Text fixups

This project makes a lot of fixups to the original text, mostly around typos, punctuation, capitalization, and consistency. You can get a more specific idea of what these are via the code; there's [`convert-worker.js`](https://github.com/domenic/worm-scraper/blob/master/lib/convert-worker.js), where some things are handled generally, and [`substitutions.json`](https://github.com/domenic/worm-scraper/blob/master/lib/substitutions.json), for one-off fixes.

This process is designed to be extensible, so if you notice any problems with the original text that you think should be fixed, file an issue to let me know, and we can update the fixup code so that the resulting ebook is improved. (Or better yet, send a pull request!)
