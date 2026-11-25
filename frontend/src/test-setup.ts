/*
 * Tests unitaires : le navigateur simulé (jsdom) annonce l'anglais. Les tests
 * vérifient les textes français, la langue par défaut de l'application ; le
 * passage à l'anglais est testé à part (i18n.service.spec.ts).
 */
Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
Object.defineProperty(navigator, 'languages', { value: ['fr-FR', 'fr'], configurable: true });
