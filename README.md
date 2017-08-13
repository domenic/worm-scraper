# _Worm_ Scraper

Scrapes the web serial [_Worm_](https://parahumans.wordpress.com/) into an eBook format.

## How to use

First you'll need a modern version of [Node.js](https://nodejs.org/en/). Install whatever is current (not LTS); at least v8.x is necessary.

Then, open a terminal ([Mac documentation](http://blog.teamtreehouse.com/introduction-to-the-mac-os-x-command-line), [Windows documentation](http://www.howtogeek.com/235101/10-ways-to-open-the-command-prompt-in-windows-10/)) and install the program by typing

```
npm install -g worm-scraper
```

This will take a while as it downloads this program and its dependencies from the internet. Once it's done, try to run it, by typing:

```
worm-scraper --help
```

If this outputs some help documentation, then the installation process went smoothly. You can move on to assemble the eBook by typing

```
worm-scraper download convert scaffold zip
```

This will take a while, but will eventually produce a `Worm.epub` file!

## EPUB vs. other formats

EPUB is one of the primary eBook formats, but it is not recognized by all readers, including most Amazon Kindle devices. You can use an online converter or other tool to convert EPUB to Kindle MOBI, or any other format.

Alternately, if you are a developer, a pull request adding support for MOBI output would be appreciated; please open an issue to discuss how you plan to proceed.
