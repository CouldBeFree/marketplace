// Конфіг архітектурного гейта (ДЗ #32). dependency-cruiser перевіряє ГРАФ імпортів проти правил.
// У demo:gates його ганяють на двох фікстурах: demo/gates/arch/ok (чисто → exit 0) і
// demo/gates/arch/broken (імпорт із forbidden/ → exit≠0). У CI тим самим конфігом перевіряємо src/.
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Циклічні залежності заборонені — КРІМ ORM-сутностей: двоспрямовані relations TypeORM ' +
        '(@OneToMany ↔ @ManyToOne) циклічні за ТИПОМ навмисно й безпечно, тож src/entities/ виключено.',
      from: { pathNot: '^src/entities/' },
      to: { circular: true },
    },
    {
      name: 'not-to-forbidden',
      severity: 'error',
      comment: 'Модулі шару forbidden/ не можна імпортувати ззовні (напрям залежностей — усередину).',
      from: {},
      to: { path: '(^|/)forbidden/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'] },
  },
};
