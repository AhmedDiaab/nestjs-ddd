# Documentation

Start here. Each link is one focused document.

## I want to…

| Task                                                                           | Read                                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Understand how the template is structured                                      | [Architecture overview](architecture/overview.md)                                 |
| Know what repository, DAO, gateway, read model… mean here and when to use each | [Glossary](glossary.md)                                                           |
| Build a complete feature end to end                                            | [Feature walkthrough](guides/feature-walkthrough.md)                              |
| Move an existing service onto this template                                    | [Migrate a legacy service](guides/migrate-a-legacy-service.md)                    |
| Add an entity or value object                                                  | [Add a value object and entity](guides/add-value-object-and-entity.md)            |
| Load/save an aggregate from the database                                       | [Add a repository](guides/add-repository.md)                                      |
| Add a read-only query (lists, details, reports)                                | [Add a query port and DAO](guides/add-query-port-and-dao.md)                      |
| Use another team's database (procedures, functions, cursors, no migrations)    | [Work with a database you don't own](guides/work-with-a-database-you-dont-own.md) |
| Add business logic                                                             | [Add a use case](guides/add-use-case.md)                                          |
| Expose an HTTP endpoint                                                        | [Add a controller](guides/add-controller.md)                                      |
| Return a specific HTTP status for a failure                                    | [Add an error](guides/add-error.md)                                               |
| Add an environment variable                                                    | [Add a config variable](guides/add-config-variable.md)                            |
| Connect another database / schema                                              | [Add a database source](guides/add-database-source.md)                            |
| Implement Postgres, MySQL…                                                     | [Implement a database dialect](guides/add-database-dialect.md)                    |
| Test any of the above                                                          | [Write tests](guides/write-tests.md)                                              |
| Run it in Docker (with a local Oracle)                                         | [Operations → Docker](architecture/operations.md#docker)                          |
| Run it as a Windows service or wire a monitoring tool                          | [Operations](architecture/operations.md)                                          |
| Work on this repo with an AI agent                                             | [`AGENTS.md`](../AGENTS.md) and [Agentic development](agentic-development.md)     |

## Reference

**Architecture**

- [Overview](architecture/overview.md): layers, dependency rules, folder map, request lifecycle
- [Diagrams](architecture/diagrams.md): request sequence, layers, database call
- [Dependency injection](architecture/dependency-injection.md): typed tokens, `ProviderFactory`, where ports live
- [Domain layer](architecture/domain-layer.md): entities, value objects, aggregates, domain errors
- [Application layer](architecture/application-layer.md): use cases, `Result`, ports, application errors
- [HTTP interface](architecture/http-interface.md): envelope, validation, errors → status, auth, guards, Swagger, security
- [Database](architecture/database.md): sources, pools, Oracle client, context user, transactions, errors, health
- [Configuration](architecture/configuration.md): env pipeline and every variable
- [Logging](architecture/logging.md)
- [Testing](architecture/testing.md)
- [Operations](architecture/operations.md): build, run, health endpoints, Windows service, shutdown

**[Glossary](glossary.md)**: the vocabulary (repository, DAO, query port, gateway, read model, unit of work…) and which one to pick.

**Decisions** ([index](decisions/README.md)): why things are the way they are.

**Guides** use one running example, a _Tickets_ feature (open, close, get, list). Its code was compiled and tested against this template; the full implementation is on the `example/tickets` branch.

## Conventions used in these docs

- Paths are relative to the repository root.
- `@domain`, `@application`, `@infrastructure`, `@interface`, `@common`, `@shared` are TypeScript path aliases for `src/<layer>`.
- "Port" = an interface a layer depends on; "adapter" = the infrastructure class that implements it.
