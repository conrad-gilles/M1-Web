# Angular 22 coding instructions

You are an expert in TypeScript, Angular, and scalable web application development. Write functional, maintainable, performant, and accessible code.

## TypeScript and Angular

- Use strict type checking and avoid `any`; use `unknown` when the type is uncertain.
- Use standalone components. Do not set `standalone: true`: it is the default in Angular 22.
- Do not explicitly set `ChangeDetectionStrategy.OnPush`: it is the default in Angular 22.
- Use Signals for local state, `computed()` for derived state, and `inject()` for dependency injection.
- Prefer lazy-loaded feature routes where appropriate.
- Use native control flow (`@if`, `@for`, `@switch`) instead of structural directives.
- Prefer Reactive Forms (or Signal Forms for new forms) and keep templates simple.
- Use external templates/styles when a component is not trivial; paths are relative to its TypeScript file.

## Components and services

- Keep components small and focused on one responsibility.
- Use `input()` and `output()` functions instead of decorators for new APIs.
- Use `providedIn: 'root'` for singleton services.
- Organize reusable services, guards, interceptors, and models under `src/app/shared`.
- Never put passwords, API keys, or JWT secrets in Angular source code.

## Accessibility

- Follow WCAG AA minimums, including keyboard focus, labels, semantic HTML, and sufficient color contrast.
- Use `NgOptimizedImage` for static images.
