/** Shared front↔back contract — fastcal POC */
export type Meal = 'reggeli' | 'ebed' | 'vacsora' | 'snack';

export type Food = {
  id: string;
  name: string;
  brand?: string;
  kcal100: number;
  protein100: number;
  fat100: number;
  carbs100: number;
  source: 'usda' | 'off' | 'custom' | 'history' | 'chain' | 'grocery';
  ean?: string;
  /** grams in one serving when known (OFF or custom) */
  servingGrams?: number;
  /** e.g. "1 adag", "1 db" */
  servingLabel?: string;
};

export type DiaryEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  meal: Meal;
  foodId: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  createdAt: number;
};

export type DayTotals = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type SearchHit = Food & { score?: number };

export type DataApi = {
  getEntries(date: string): Promise<DiaryEntry[]>;
  addEntry(input: {
    date: string;
    meal: Meal;
    food: Food;
    grams: number;
  }): Promise<DiaryEntry>;
  updateGrams(id: string, grams: number): Promise<DiaryEntry>;
  removeEntry(id: string): Promise<void>;
  copyMeal(fromDate: string, toDate: string, meal: Meal): Promise<void>;
  copyDay(fromDate: string, toDate: string): Promise<void>;
  search(q: string): Promise<SearchHit[]>;
  recentFoods(limit?: number): Promise<Food[]>;
  frequentFoods(limit?: number): Promise<Array<Food & { defaultGrams: number }>>;
  yesterdaySameMeal(date: string, meal: Meal): Promise<DiaryEntry[]>;
  lookupEan(ean: string): Promise<Food | null>;
  saveCustom(food: Omit<Food, 'id' | 'source'> & { kcal100: number }): Promise<Food>;
  getKcalGoal(): Promise<number>;
  setKcalGoal(kcal: number): Promise<void>;
  /** ISO dates (inclusive range) that have ≥1 entry */
  getLoggedDates(from: string, to: string): Promise<string[]>;
  /** kcal sum per ISO date in range */
  getDayKcalMap(from: string, to: string): Promise<Record<string, number>>;
};
