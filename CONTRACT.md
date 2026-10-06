# Front ↔ Back contract

`DataApi` in `src/types.ts`:

| method | notes |
|--------|--------|
| `getEntries(date)` | YYYY-MM-DD |
| `addEntry({date,meal,food,grams})` | no confirm UI — immediate |
| `updateGrams(id, grams)` | inline list edit |
| `removeEntry(id)` | |
| `copyMeal` / `copyDay` | |
| `search(q)` | own/history first, then HU/EU nutritionally complete |
| `recentFoods` / `frequentFoods` | for quick chips |
| `yesterdaySameMeal(date, meal)` | |
| `lookupEan(ean)` | OFF + local cache; null → manual kcal/100g |
| `saveCustom(...)` | own foods list |

Meals: `reggeli | ebed | vacsora | snack`

Macros on entry are stored denormalized for instant bottom bar.
