// Curated pools for procedural persona generation. Deliberately broad and
// lightweight — no external data needed. Weights approximate real distributions.

export const MALE_NAMES = [
  "James", "Liam", "Noah", "Oliver", "Elijah", "Lucas", "Mason", "Ethan",
  "Kai", "Diego", "Mateo", "Arjun", "Wei", "Hiroshi", "Omar", "Yusuf",
  "Kwame", "Sipho", "Andrei", "Sven", "Marco", "Tariq", "Ravi", "Chen",
  "Malik", "Idris", "Rohan", "Sean", "Theo", "Felix", "Nikolai", "Amir",
] as const;

export const FEMALE_NAMES = [
  "Olivia", "Emma", "Ava", "Sophia", "Isabella", "Mia", "Amara", "Priya",
  "Yuki", "Sofia", "Lucia", "Aisha", "Fatima", "Ingrid", "Nadia", "Zara",
  "Ling", "Sakura", "Chiara", "Ada", "Nia", "Leila", "Anya", "Mei",
  "Thandiwe", "Freya", "Camila", "Hana", "Rania", "Esme", "Noor", "Elena",
] as const;

export const NEUTRAL_NAMES = [
  "Alex", "Sam", "Jordan", "Taylor", "Morgan", "Riley", "Quinn", "Rowan",
  "Sky", "River", "Ari", "Remy", "Dakota", "Phoenix", "Sage",
] as const;

export const LAST_NAMES = [
  "Smith", "Garcia", "Nguyen", "Kim", "Patel", "Okoro", "Rossi", "Muller",
  "Ivanov", "Haddad", "Silva", "Tanaka", "Cohen", "Andersson", "Dubois",
  "Kowalski", "Santos", "Fernandez", "Abebe", "Yilmaz", "Novak", "Reyes",
  "Khan", "Wang", "Sato", "Mbeki", "O'Brien", "Larsson", "Rahman", "Costa",
  "Bianchi", "Petrov", "Adeyemi", "Chowdhury", "Moreau", "Sokolov", "Diaz",
] as const;

// [country, weight, [cities]]
export const REGIONS: readonly (readonly [string, number, readonly string[]])[] = [
  ["United States", 20, ["New York", "Austin", "Portland", "Chicago", "Atlanta", "Denver"]],
  ["India", 18, ["Mumbai", "Bangalore", "Delhi", "Pune", "Chennai"]],
  ["China", 18, ["Shanghai", "Beijing", "Chengdu", "Shenzhen"]],
  ["Nigeria", 6, ["Lagos", "Abuja", "Ibadan"]],
  ["Brazil", 8, ["São Paulo", "Rio de Janeiro", "Belo Horizonte"]],
  ["Japan", 5, ["Tokyo", "Osaka", "Kyoto"]],
  ["Germany", 4, ["Berlin", "Munich", "Hamburg"]],
  ["United Kingdom", 4, ["London", "Manchester", "Bristol"]],
  ["Mexico", 5, ["Mexico City", "Guadalajara", "Monterrey"]],
  ["Egypt", 3, ["Cairo", "Alexandria"]],
  ["Sweden", 2, ["Stockholm", "Gothenburg"]],
  ["Kenya", 3, ["Nairobi", "Mombasa"]],
  ["France", 4, ["Paris", "Lyon", "Marseille"]],
  ["Indonesia", 6, ["Jakarta", "Surabaya", "Bandung"]],
];

// [occupation, weight]. "student"/"retired"/"child" are assigned by age instead.
export const OCCUPATIONS: readonly (readonly [string, number])[] = [
  ["software engineer", 6], ["nurse", 6], ["teacher", 7], ["barista", 4],
  ["accountant", 4], ["graphic designer", 3], ["electrician", 4], ["chef", 3],
  ["marketing manager", 3], ["farmer", 4], ["truck driver", 4], ["doctor", 3],
  ["journalist", 2], ["mechanic", 4], ["artist", 2], ["musician", 2],
  ["small business owner", 4], ["social worker", 3], ["data analyst", 3],
  ["carpenter", 3], ["pharmacist", 2], ["photographer", 2], ["lawyer", 3],
  ["barber", 2], ["park ranger", 1], ["flight attendant", 2], ["plumber", 3],
  ["research scientist", 2], ["bartender", 3], ["real estate agent", 3],
  ["game developer", 2], ["yoga instructor", 1], ["librarian", 2],
];

export const EDUCATION: readonly (readonly [string, number])[] = [
  ["high school", 30], ["some college", 20], ["bachelor's degree", 30],
  ["master's degree", 12], ["trade certification", 6], ["doctorate", 2],
];

export const INTERESTS = [
  "hiking", "cooking", "indie music", "sci-fi novels", "photography",
  "gardening", "video games", "climbing", "cycling", "painting",
  "astronomy", "coffee", "board games", "yoga", "birdwatching",
  "vintage synths", "running", "baking sourdough", "chess", "surfing",
  "pottery", "fermentation", "urban foraging", "film noir", "jazz",
  "woodworking", "tabletop RPGs", "mechanical keyboards", "tea", "podcasts",
  "street food", "sustainability", "cryptozoology", "true crime", "knitting",
  "vinyl records", "rock climbing", "meditation", "electronics", "travel",
  "houseplants", "stand-up comedy", "anime", "history", "poetry",
];

export const TOPICS = [
  "the weather turning", "a book they just finished", "a new recipe",
  "weekend plans", "a frustrating commute", "a small personal win",
  "a documentary they watched", "the state of the world", "a hobby project",
  "an old friend they miss", "a change at work", "something in the news",
  "a memory from childhood", "a local event", "an unpopular opinion",
];

export const REACTION_TYPES = ["like", "love", "laugh", "wow", "sad", "angry"] as const;
