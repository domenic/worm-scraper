"use strict";

exports.worm = {
  startURL: "https://parahumans.wordpress.com/2011/06/11/1-1/",
  title: "Worm",
  id: "e7f3532d-8db6-4888-be80-1976166b7059",

  // First paragraph of https://parahumans.wordpress.com/about/
  // eslint-disable-next-line max-len
  description: `An introverted teenage girl with an unconventional superpower, Taylor goes out in costume to find escape from a deeply unhappy and frustrated civilian life. Her first attempt at taking down a supervillain sees her mistaken for one, thrusting her into the midst of the local ‘cape’ scene’s politics, unwritten rules, and ambiguous morals. As she risks life and limb, Taylor faces the dilemma of having to do the wrong things for the right reasons.`
};

exports["glow-worm"] = {
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
  startURL: "https://www.parahumans.net/2017/10/21/glow-worm-0-1/",
  stopURL: "https://www.parahumans.net/2017/11/07/glow-worm-0-9/",
  title: "Glow-worm",
  id: "4fb81736-a29a-43b6-804e-ef1b02e6265c",

  // From https://www.parahumans.net/table-of-contents/
  // eslint-disable-next-line max-len
  description: `The Glow-worm chapters were a teaser event leading up to Worm 2. They aren’t required reading but offer flavor and additional angles by which to view certain characters. They take the form of forum posts, chat conversations and emails. They’re best described as a kind of a post-Worm-epilogue, pseudo-Ward-prologue bridge between the series.`
};

exports.ward = {
  startURL: "https://www.parahumans.net/2017/09/11/daybreak-1-1/",
  title: "Ward",
  id: "a6b6b156-2f17-43c0-8bb1-bfa91f3ef62a",

  // Synposis from https://www.parahumans.net/
  /* eslint-disable max-len */
  description: `The unwritten rules that govern the fights and outright wars between ‘capes’ have been amended: everyone gets their second chance. It’s an uneasy thing to come to terms with when notorious supervillains and even monsters are playing at being hero. The world ended two years ago, and as humanity straddles the old world and the new, there aren’t records, witnesses, or facilities to answer the villains’ past actions in the present. One of many compromises, uneasy truces and deceptions that are starting to splinter as humanity rebuilds.

None feel the injustice of this new status quo or the lack of established footing more than the past residents of the parahuman asylums. The facilities hosted parahumans and their victims, but the facilities are ruined or gone; one of many fragile ex-patients is left to find a place in a fractured world. She’s perhaps the person least suited to have anything to do with this tenuous peace or to stand alongside these false heroes. She’s put in a position to make the decision: will she compromise to help forge what they call, with dark sentiment, a second golden age? Or will she stand tall as a gilded dark age dawns?`
  /* eslint-enable max-len */
};
