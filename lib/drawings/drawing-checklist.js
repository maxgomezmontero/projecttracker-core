// The 44-criteria layout self-check, as data. Each item: id, text, hi (high-impact).
// Written from the tool owner's review practice; names of people and companies replaced (see SCRUBBING.md).
const DRAWING_CHECKLIST = {
 "groups": [
  {
   "id": 1,
   "title": "Title block, numbering and revisions",
   "items": [
    {
     "id": "1-1",
     "text": "Number is -L01 after the PO (-P01 only at proposal stage); title block number matches the file name.",
     "hi": false
    },
    {
     "id": "1-2",
     "text": "Rev, date and 'SHEET X OF N' identical and consistent on every sheet of the set.",
     "hi": false
    },
    {
     "id": "1-3",
     "text": "CHECKED field carries the reviewer's initials and date before issue.",
     "hi": false
    },
    {
     "id": "1-4",
     "text": "No customer name in the title block when the drawing is shared as a reference with another customer.",
     "hi": false
    },
    {
     "id": "1-5",
     "text": "Customer name matches the legal name on the PO.",
     "hi": false
    },
    {
     "id": "1-6",
     "text": "Only the current revision sits in the 'By Us' drawings folder; older revisions moved to NonCurrent.",
     "hi": false
    },
    {
     "id": "1-7",
     "text": "Standard file name: PROJECT-L01_RevN_Customer_Description (no initials, dates or work suffixes).",
     "hi": false
    }
   ]
  },
  {
   "id": 2,
   "title": "Views and sheets",
   "items": [
    {
     "id": "2-1",
     "text": "Plan view plus elevation views; every height, offset and opening also checked in elevation.",
     "hi": true
    },
    {
     "id": "2-2",
     "text": "Building context shown: columns with grid, main steel, walls (with thickness), aisles, doors, wall girts, purlins, sprinklers, ventilation ducts, existing mains.",
     "hi": true
    },
    {
     "id": "2-3",
     "text": "Part loading detail: max part drawn in the opening, conveyor end view, hook pitch, indexing, load per hook.",
     "hi": true
    },
    {
     "id": "2-4",
     "text": "Plan view oriented from the production side; rotate the building block in model space, not the view.",
     "hi": false
    },
    {
     "id": "2-5",
     "text": "Sheet 1 = layout + utility chart; site plan only to locate the system; everything inside the frame.",
     "hi": false
    },
    {
     "id": "2-6",
     "text": "Only relevant views. Show a future phase only if it demonstrates expansion capacity and is not being quoted.",
     "hi": false
    }
   ]
  },
  {
   "id": 3,
   "title": "Dimensions and references",
   "items": [
    {
     "id": "3-1",
     "text": "Penetrations located by centerline, never by the edge of the opening.",
     "hi": false
    },
    {
     "id": "3-2",
     "text": "Datum taken from building steel or wall (column grid), not from our own equipment.",
     "hi": false
    },
    {
     "id": "3-3",
     "text": "Overall system dimensions X and Y shown and checked against the available space.",
     "hi": false
    },
    {
     "id": "3-4",
     "text": "Equipment dimensioned with working and overall dimensions, work and product openings (the equipment, not the curb).",
     "hi": true
    },
    {
     "id": "3-5",
     "text": "Vertical references explicit: TOR, bottom of duct / diffuser, top of roof deck vs. ceiling, roof thickness.",
     "hi": true
    },
    {
     "id": "3-6",
     "text": "Drawn to true scale; offsets and interferences verified in AutoCAD, not estimated.",
     "hi": false
    },
    {
     "id": "3-7",
     "text": "Standard clearances respected and dimensioned (see table).",
     "hi": true
    },
    {
     "id": "3-8",
     "text": "Layout agrees with RFQ, quote and vendor drawings (TOR, widths, pitch, rail spacing, notes).",
     "hi": true
    }
   ]
  },
  {
   "id": 4,
   "title": "Utilities and penetrations",
   "items": [
    {
     "id": "4-1",
     "text": "Utility chart on sheet 1, IDs shown in the plan, sorted alphanumerically, visible in the PDF.",
     "hi": true
    },
    {
     "id": "4-2",
     "text": "Correct ID prefixes: X exhaust, F fresh air, E electrical, A compressed air, B breathing air, G gas, W water.",
     "hi": false
    },
    {
     "id": "4-3",
     "text": "Electrical complete: service amps + FLA + voltage / phase / wires (request 4-wire if available).",
     "hi": true
    },
    {
     "id": "4-4",
     "text": "All services listed: air per consumer, Grade D breathing air, 120 V for paint equipment and chain oiler, gas with PSI and BTU/h.",
     "hi": true
    },
    {
     "id": "4-5",
     "text": "Each penetration has duct size, curb / opening 'BY OTHERS', and penetration and curb details.",
     "hi": true
    },
    {
     "id": "4-6",
     "text": "Penetrations clear purlins, joists, sprinklers and services; consider moving the system before adding offsets.",
     "hi": true
    },
    {
     "id": "4-7",
     "text": "Vendor utilities confirmed before entering; if pending write 'VERIFY WITH <vendor>' or 'ESTIMATED', never a bare 'TBD'.",
     "hi": false
    }
   ]
  },
  {
   "id": 5,
   "title": "Notes, callouts and 'by others' scope",
   "items": [
    {
     "id": "5-1",
     "text": "Numbered conveyor NOTES: TOR, track type, load bar / trolleys, hook spacing, indexing, max load, hangers BY OTHERS.",
     "hi": false
    },
    {
     "id": "5-2",
     "text": "'BY OTHERS' scope explicit: curbs and openings, building supports, concrete, crane, chiller plumbing, booth modifications.",
     "hi": true
    },
    {
     "id": "5-3",
     "text": "Device callouts: E-stops, start/stop, panels, chain lubricator, paint equipment; panels outside the hanging-part zone.",
     "hi": false
    },
    {
     "id": "5-4",
     "text": "Equipment tags carry the correct vendor serial number and are consistent across the set.",
     "hi": false
    },
    {
     "id": "5-5",
     "text": "Changes and discrepancies noted on the L01 itself.",
     "hi": false
    }
   ]
  },
  {
   "id": 6,
   "title": "Format and delivery",
   "items": [
    {
     "id": "6-1",
     "text": "Re-plot every PDF from the current DWG after each change; one PDF per sheet, same base name.",
     "hi": false
    },
    {
     "id": "6-2",
     "text": "Clean DWG for vendors; PDF for customers.",
     "hi": false
    },
    {
     "id": "6-3",
     "text": "Vendor drawings saved in the project's By Others folder.",
     "hi": false
    },
    {
     "id": "6-4",
     "text": "Issue as a complete package, not piecemeal.",
     "hi": false
    },
    {
     "id": "6-5",
     "text": "Scale stated per view when the view is used to measure; NTS only for concept sketches.",
     "hi": false
    }
   ]
  },
  {
   "id": 7,
   "title": "Review and communication",
   "items": [
    {
     "id": "7-1",
     "text": "Internal review with the engineering lead before anything goes to the customer or vendors.",
     "hi": true
    },
    {
     "id": "7-2",
     "text": "Our system layout is the controlling layout; customer signs L01 together with the vendor GA.",
     "hi": true
    },
    {
     "id": "7-3",
     "text": "Vendor drawings are marked up to suit our equipment, not the other way around.",
     "hi": true
    },
    {
     "id": "7-4",
     "text": "Vendor requests are explicit and include a dimensioned sketch.",
     "hi": false
    },
    {
     "id": "7-5",
     "text": "Do not expose internal decisions to the customer or ask them to measure what the vendor should know.",
     "hi": false
    },
    {
     "id": "7-6",
     "text": "Schedule allows at least 1 week to integrate vendor drawings before submittal.",
     "hi": false
    }
   ]
  }
 ],
 "clearances": [
  [
   "AMU to wall",
   ">= 3 ft"
  ],
  [
   "Around AMU / panel side",
   "36 in / 48 in"
  ],
  [
   "Exhaust discharge to intake",
   ">= 10 ft"
  ],
  [
   "Intake above roof",
   ">= 3 ft"
  ],
  [
   "Duct to wall girt",
   "6 in (2 in min.)"
  ],
  [
   "Wall < 3 ft from equipment",
   "non-combustible"
  ],
  [
   "Solenoid to door / lubricator to opening",
   "> 3 ft / >= 3 ft"
  ],
  [
   "Stacks vs. roof edge",
   "keep away from edge"
  ]
 ],
 "top": [
  "Utilities incomplete or incorrect",
  "Building context missing",
  "Penetrations by edge / no datum / clashing with steel",
  "Clearances not verified",
  "Layout does not match RFQ / quote / vendor drawings"
 ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = DRAWING_CHECKLIST;
