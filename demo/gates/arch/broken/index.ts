// Фікстура архітектурного гейта — ПОРУШЕННЯ шару: імпорт із forbidden/. Правило not-to-forbidden
// у .dependency-cruiser.cjs має це зловити → depcruise exit≠0. Так доводимо, що гейт реагує.
import { apiKey } from '../forbidden/secret';

export const leaked = apiKey;
