# Scrubbing record

The code in `lib/` comes from a private desktop tool used daily on real project work. Before
anything was committed here, every real identifier was removed or replaced with a fictional one.
This file says **what kinds** of identifiers were replaced and how many. The real values are
deliberately not listed.

## Method

1. Only the modules named below were copied, from a read-only copy of the private repository.
2. Each file was rewritten by hand. Comments that told the history of a fix through a real case
   (a customer, a project, a person) were rewritten to describe the rule without the case.
3. A list of real terms was assembled from the source: people's names and addresses, company and
   vendor names, domains, project, opportunity and order numbers. It was kept **outside** this
   repository, and the whole repository was grepped against it as whole words and as substrings.
   The final pass found zero hits. The author's own name appears only as the author.
4. `test/fictional-data.test.js` fails the build if any email address in the repository is not
   on the reserved `.example` domain (RFC 2606).

## What was replaced (categories and counts)

| Category | Count | Replaced with |
|---|---|---|
| The author's employer and its sister companies (names in comments, checklist text and a folder name; 3 internal mail domains) | 3 companies, 3 domains | "Example Finishing Systems", `finishing-systems.example`, a neutral "By Us" drawings folder |
| Customer and other company names used as examples in comments (stop-word notes, typo examples, state-code examples, sibling-project examples, portal examples) | 10 | fictional clients ("Client A", "Maplewood Metalworks", …) or removed |
| Vendor names in the vendor seed list | 12 | 4 fictional vendors (Northbeam, Keller, Tamarack, Brightline) |
| Vendor-specific detectors (vendor name, sender domain, order-number format) | 2 vendors, 5 detectors | fictional vendors A and B: `northbeam.example` / `N######`, `keller-ovens.example` / `K20######` |
| Third-party software and services named in code (the ERP product, a construction-document portal, a contractor-management portal, an e-signature service) | 4 | "ERP", "BuildPortal", "VendorGate", "SignBox" on `.example` domains; subject tags and code prefixes changed to match |
| People: the manager named in comments and in checklist items, and contact names used as examples | 1 manager (5 places), 3 example contacts | "the reviewer", "the engineering lead", fictional names |
| The people directory (23 colleagues with names, addresses and roles) | 23 | **left out entirely** (see below) |
| Internal PO branch codes in a key regex | 5 | 3 fictional codes (`ABC`, `DEF`, `GHI`) |
| Branch letters in the project-number regex | 5 | any capital letter (a small logic change, noted in `email-match.js`) |
| Real project / job numbers, opportunity numbers and vendor order numbers in comments, examples and tests | 13 | fictional numbers |
| The author's initials in a file-name rule (rejecting work suffixes such as `Rev2XY`) | 1 | a generic "2-3 letters after the revision" pattern (a small logic change) |
| File-system paths and data-file names of the private tool | 8 | removed. This package reads no files except those passed to the CLI |
| A business-unit code in the ERP notice example | 1 | removed |

Public platforms that appear only in the matcher's list of "automated sender, never project mail"
(e.g. LinkedIn, Zoom, DocuSign, mail-marketing services) were kept. They identify nobody and are
part of the noise rule.

## Extracted vs left out

| Module (in the private tool) | Here | Notes |
|---|---|---|
| `lib/inbox/email-match.js` | `lib/inbox/email-match.js` | Index, matcher, noise classifier, ERP opportunity notice, status-text rules: logic unchanged. The fallback summary writer (`fallbackProposal`) was **left out**: it needs the people directory to decide who an action waits on. Its status-rule loop is kept as `statusChange()`. |
| `lib/inbox/content-match.js` | same path | Unchanged apart from portal names and domains |
| `lib/inbox/detectors.js` | same path | All 13 detectors. Vendor and portal identities are fictional, and the ship-report PDF reader was replaced by an input field (`msg.shipReport`) |
| `lib/core/identity.js` | same path | Key regexes are fictional. The project-folder walk was left out |
| `lib/core/parties.js` | same path, vendors only | People directory left out |
| `lib/core/status-hints.js` | same path | ERP product name replaced by "ERP"; one data field renamed |
| `lib/drawings/layout-check.js` | same path | **Partial.** The text rules are ported to take a JSON description of the layout set. Left out: PDF reading and scale measurement (`drawings3d/*`), mail / ERP / folder evidence (`layout-evidence.js`), file timestamps. 28 of the 44 criteria are checked automatically, and the rest are listed as `notCovered` with the reason |
| `renderer/layout-check/drawing-checklist.js` | `lib/drawings/drawing-checklist.js` | The 44 criteria as data, with names replaced |
| Outlook export, inbox store, ERP sync, Electron UI, SharePoint paths | — | Not extracted (tied to Outlook COM, Electron, the ERP and company file shares) |
