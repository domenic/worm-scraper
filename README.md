# _Worm_ Scraper

Scrapes the web serial [_Worm_](https://parahumans.wordpress.com/) and its sequel [_Ward_](https://www.parahumans.net/) into an ebook format.

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

## Reading EPUBs on Amazon Kindle

EPUBs are not the native format for Amazon Kindle devices and apps. However, you can send them to your Kindle library by following [Amazon's instructions](https://www.amazon.com/gp/help/customer/display.html?nodeId=G5WYD9SAF7PGXRNA).

## Text fixups

This project makes a lot of fixups to the original text, mostly around typos, punctuation, capitalization, and consistency. You can get a more specific idea of what these are via the code; there's [`convert-worker.js`](https://github.com/domenic/worm-scraper/blob/master/lib/convert-worker.js), where some things are handled generally, and [`substitutions.json`](https://github.com/domenic/worm-scraper/blob/master/lib/substitutions.json), for one-off fixes.

This process is designed to be extensible, so if you notice any problems with the original text that you think should be fixed, file an issue to let me know, and we can update the fixup code so that the resulting ebook is improved. (Or better yet, send a pull request!)
