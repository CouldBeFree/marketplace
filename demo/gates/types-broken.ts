// Фікстура гейта типів — ЗЛАМАНИЙ ввід. `tsc --noEmit --strict` має впасти (exit≠0):
// рядок не присвоюється до number. Так доводимо, що гейт реагує на помилку, а не завжди зелений.
export const n: number = 'definitely not a number';
