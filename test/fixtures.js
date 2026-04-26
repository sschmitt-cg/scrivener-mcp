// Canonical test project definition. Both read and write test suites
// create a fresh copy of this project in a temp directory, so they always
// start from a known state with fully predictable structure and content.
export const TEST_PROJECT = {
  name: 'MCP Test Suite',
  labels: [
    { name: 'Action',        color: 'red'   },
    { name: 'Romance',       color: 'pink'  },
    { name: 'Character',     color: 'blue'  },
    { name: 'World-Building', color: 'green' },
  ],
  statuses: ['To Do', 'In Progress', 'First Draft', 'Revised Draft', 'Done'],
  manuscript: [
    {
      title: 'Act I — Setup',
      type: 'Folder',
      synopsis: 'The world and hero are introduced.',
      children: [
        {
          title: 'Chapter 1 — The World Begins',
          type: 'Folder',
          synopsis: 'Establishing the ordinary world.',
          children: [
            {
              title: 'Scene 1.1 — Opening Image',
              synopsis: 'The hero wakes at dawn.',
              content: 'The sun rose over the hills.',
              label: 'Action',
              status: 'Done',
              includeInCompile: true,
            },
            {
              title: 'Scene 1.2 — The Ordinary World',
              synopsis: 'Daily life before the call.',
              content: 'Every morning was the same.',
              label: 'Action',
              status: 'First Draft',
            },
            {
              title: 'Scene 1.3 — EXCLUDED',
              synopsis: 'A cut scene.',
              content: 'This was cut.',
              label: 'Action',
              status: 'To Do',
              includeInCompile: false,
            },
          ],
        },
        {
          title: 'Chapter 2 — Inciting Incident',
          type: 'Folder',
          synopsis: 'The event that changes everything.',
          children: [
            {
              title: 'Scene 2.1 — The Letter Arrives',
              synopsis: 'A mysterious letter changes everything.',
              content: 'The envelope bore no return address.',
              label: 'Romance',
              status: 'Revised Draft',
            },
            {
              // Intentionally no content — tests the empty-content read path
              title: 'Scene 2.2 — First Meeting',
              synopsis: 'Hero meets the love interest.',
              label: 'Romance',
              status: 'In Progress',
            },
          ],
        },
      ],
    },
    {
      title: 'Act II — Confrontation',
      type: 'Folder',
      synopsis: 'The hero faces escalating challenges.',
      children: [
        {
          title: 'Chapter 3 — Rising Stakes',
          type: 'Folder',
          synopsis: 'Complications multiply.',
          children: [
            {
              title: 'Scene 3.1 — The Complication',
              synopsis: 'Things get worse.',
              content: 'Nothing was going as planned.',
              label: 'Action',
              status: 'First Draft',
            },
          ],
        },
        {
          title: 'Chapter 4 — Midpoint',
          type: 'Folder',
          synopsis: 'Everything hangs in the balance.',
          children: [
            {
              // Intentionally no content — tests the empty-content read path
              title: 'Scene 4.1 — All Is Lost',
              synopsis: 'The darkest moment.',
              label: 'Action',
              status: 'To Do',
            },
          ],
        },
      ],
    },
  ],
  research: [
    {
      title: 'Characters',
      type: 'Folder',
      children: [
        {
          title: 'Hero Profile',
          synopsis: "The protagonist's background and motivation.",
          content: 'Name: Alex\nAge: 28\nGoal: Find the treasure.',
          label: 'Character',
        },
        {
          title: 'Villain Profile',
          synopsis: "The antagonist's backstory.",
          content: 'Name: Dr. Malice\nAge: 55\nGoal: World domination.',
          label: 'Character',
        },
      ],
    },
    {
      title: 'World Notes',
      type: 'Folder',
      children: [
        {
          title: 'Map Notes',
          synopsis: 'Geography of the world.',
          content: 'The kingdom spans three continents.',
          label: 'World-Building',
        },
      ],
    },
  ],
};

// Expected label ID mapping created by ScrivenerProject.create()
// '0' is always the built-in "No Label"; user-defined labels start at '1'.
export const LABEL_IDS = {
  'No Label':       '0',
  'Action':         '1',
  'Romance':        '2',
  'Character':      '3',
  'World-Building': '4',
};

// Expected status ID mapping. '0' is "No Status"; user-defined start at '1'.
export const STATUS_IDS = {
  'No Status':     '0',
  'To Do':         '1',
  'In Progress':   '2',
  'First Draft':   '3',
  'Revised Draft': '4',
  'Done':          '5',
};

// Total binder items: Manuscript + 13 descendants = 14,
// Research + 5 descendants = 6, Trash = 1. Total = 21.
export const EXPECTED_ITEM_COUNT = 21;
