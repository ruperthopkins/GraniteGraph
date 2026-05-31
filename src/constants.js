export const CEMETERY_ID = 'd8bd1f88-cdde-4ef2-a448-5ab04d2d8107'

export const SOURCE_IDS = {
  CHURCH:               '800c5884-d180-42b0-9ca6-4e05c8fd64cb',
  MALLMANN:             '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155',
  WHITE_TILLOTSON_2008: 'a3b4c5d6-e7f8-4901-bcde-f01234567890',
  WHITE_TILLOTSON_2001: 'e5f6a7b8-c9d0-4e01-efab-c01234567890',
  WHITE_MILLER_2007:    'f6a7b8c9-d0e1-4f01-abcd-ef1234567890',
  // Alias kept for any code still referencing SOURCE_IDS.WHITE
  WHITE:                'a3b4c5d6-e7f8-4901-bcde-f01234567890',
}

export const ROLES = {
  ADMIN:      'admin',
  RESEARCHER: 'researcher',
  VOLUNTEER:  'volunteer',
}

export const REL_LABEL = {
  spouse:  'Spouse of',
  parent:  'Parent of',
  child:   'Child of',
  sibling: 'Sibling of',
  unknown: 'Related to',
}

export const INVERSE_REL = {
  spouse:  'spouse',
  parent:  'child',
  child:   'parent',
  sibling: 'sibling',
  unknown: 'unknown',
}
