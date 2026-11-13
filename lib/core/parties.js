// ─── Parties: the vendor list the matcher needs ───────────────────────────────
// In the private tool this module also holds the people directory (who is "me", the manager, the
// team) and owner logic for action items. Only the vendor seed is needed by the matcher: vendor
// names appear in every project that buys from them, so they must never identify one project.
// All vendors below are fictional.
'use strict';

const SEED_VENDORS = [
  { name: 'Northbeam', aliases: ['Northbeam', 'Northbeam Finishing'], domains: ['northbeam.example'] },
  { name: 'Keller',    aliases: ['Keller', 'Keller Ovens'],           domains: ['keller-ovens.example'] },
  { name: 'Tamarack',  aliases: ['Tamarack Blast'],                   domains: ['tamarack-blast.example'] },
  { name: 'Brightline', aliases: ['Brightline Coatings'],             domains: ['brightline.example'] },
];

module.exports = { SEED_VENDORS };
