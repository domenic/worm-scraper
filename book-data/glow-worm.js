"use strict";

module.exports = {
  title: "Glow-worm",
  id: "4fb81736-a29a-43b6-804e-ef1b02e6265c",
  groupPosition: 2,

  // From https://www.parahumans.net/table-of-contents/
  // eslint-disable-next-line max-len
  description: `The Glow-worm chapters were a teaser event leading up to Worm 2. They aren’t required reading but offer flavor and additional angles by which to view certain characters. They take the form of forum posts, chat conversations and emails. They’re best described as a kind of a post-Worm-epilogue, pseudo-Ward-prologue bridge between the series.`,

  // We have a choice between https://parahumans.wordpress.com/2017/10/21/glowworm-p-1/ and
  // https://www.parahumans.net/2017/10/21/glow-worm-0-1/.
  //
  // The latter seems slightly better in some ways, for example:
  // * In the latter, messages from the same user are grouped together into <p>s with <br>s separating each message.
  //   In the former, all messages regardless of user are separated by <br>s, with no per-user grouping.
  // * In the latter, in https://parahumans.wordpress.com/2017/10/26/glow-worm-p-3/ "Private Conversation with
  //   Point_Me_@_The_Sky", the user talking (Mangled_Wings) has their name bolded, which makes sense; in the former,
  //   both users have their names bolded.
  // * In the latter, we use the Ward-style "⊙" scene breaks, instead of the Worm-style "■" scene breaks.
  arcs: [
    {
      invisible: true,
      chapters: [
        {
          url: "https://www.parahumans.net/2017/10/21/glow-worm-0-1/",
          simplifiedTitle: "1",
          characterNamesTitle: "Point_Me_@_The_Sky"
        },
        {
          url: "https://www.parahumans.net/2017/10/24/glow-worm-0-2/",
          simplifiedTitle: "2",
          characterNamesTitle: "Capricorn"
        },
        {
          url: "https://www.parahumans.net/2017/10/26/glow-worm-0-3/",
          simplifiedTitle: "3",
          characterNamesTitle: "Mangled_Wings"
        },
        {
          url: "https://www.parahumans.net/2017/10/28/glow-worm-0-4/",
          simplifiedTitle: "4",
          characterNamesTitle: "of5"
        },
        {
          url: "https://www.parahumans.net/2017/10/31/glow-worm-0-5/",
          simplifiedTitle: "5",
          characterNamesTitle: "Point_Me_@_The_Sky, part 2"
        },
        {
          url: "https://www.parahumans.net/2017/10/31/glow-worm-0-6/",
          simplifiedTitle: "6",
          characterNamesTitle: "Questionable_Cephalopod"
        },
        {
          url: "https://www.parahumans.net/2017/11/02/glow-worm-0-7/",
          simplifiedTitle: "7",
          characterNamesTitle: "Heart_Shaped_Pupil"
        },
        {
          url: "https://www.parahumans.net/2017/11/04/glow-worm-0-8/",
          simplifiedTitle: "8",
          characterNamesTitle: "Space_Squid"
        },
        {
          url: "https://www.parahumans.net/2017/11/07/glow-worm-0-9/",
          simplifiedTitle: "9",
          characterNamesTitle: "Point_Me_@_The_Sky, part 3"
        }
      ]
    }
  ]
};
