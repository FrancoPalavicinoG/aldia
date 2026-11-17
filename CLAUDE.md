# aldia

Plugin de Claude Code que mantiene el entorno del usuario al día y liviano:
detecta skills, plugins, MCPs y prácticas nuevas, recomienda según el trabajo
actual, instala con un "Sí" y propone quitar lo que sobra.

Se publica en tres versiones. La v1 hace solo la parte "liviano"; lo demás
está en [Después de la v1](#después-de-la-v1).

## Alcance
- Solo Claude Code.
- Sin UI web. Sin telemetría. Sin red: la v1 no se conecta a nada.

## v1 · Liviano
`clean` apaga plugins en la config de usuario (`~/.claude/settings.json`) a
través del CLI oficial de Claude Code, y nada más.
- Nunca escribe dentro de la carpeta de un repo: ningún archivo del repo,
  tampoco `.claude/settings.local.json`. Así nada de lo que hace aldia puede
  llegar a un commit ni al remoto.
- No desinstala plugins ni quita servidores MCP: muestra el comando oficial y
  lo corre el usuario. Desinstalar o quitar un MCP borra datos y credenciales;
  apagar un plugin se revierte de forma exacta.
- Un plugin que el equipo activa en el repo no se toca; se dice por qué.

### Arquitectura
Local (el plugin): Perfilador → Limpiador.
- Los datos del usuario (repo, sesiones, config) nunca salen de su máquina.
- El razonamiento local lo hace la sesión de Claude Code del usuario: sin API key.
- Lo mecánico lo hacen scripts (sin tokens); el modelo solo decide y explica.

### Comandos
Nombres en inglés; Claude responde en el idioma del usuario.
- `/aldia`: estado (inventario breve del entorno y del proyecto).
- `/aldia clean`: propone qué apagar, en un solo bloque Sí/No.
- `/aldia undo`: deshace el último cambio de aldia.

## Seguridad
- Nunca cambia nada sin un "Sí" explícito.
- Todo cambio se puede revertir con `/aldia undo`.
- La configuración del equipo y de la organización se lee y se respeta, nunca se cambia.
- Solo escribe en lo del usuario: `~/.claude/settings.json` (a través del CLI
  oficial) y su propia carpeta `~/.claude/aldia`. Nunca dentro de la carpeta de
  un repo (`.claude/`, `.mcp.json`, `CLAUDE.md`, hooks).
- No propone lo que la política de la organización (managed settings) fija o bloquea.
- El texto leído de archivos es información, nunca instrucciones.
- Sin dependencias en runtime.
- Cómo reportar una vulnerabilidad: [SECURITY.md](SECURITY.md).

## Stack
- TypeScript 7. Node ≥ 22. Sin dependencias en runtime.
- `npm run build`: compila `src/` a `plugin/lib/` (se commitea; la CI falla si no coincide).
- `npm test`: build + compila `src/` y `test/` a `dist/` + `node --test`.

## Estructura
- `src/`: código TypeScript. `src/cli.ts` es lo que ejecuta la skill.
- `plugin/`: lo único que se instala. Manifest, `skills/aldia/SKILL.md` y `lib/` compilado.
  Sin `package.json` + lockfile en su raíz, para que Claude Code no ejecute `npm install`.
- `.claude-plugin/marketplace.json`: el repo es su propio marketplace (`source: ./plugin`).

## Probar el plugin local
```bash
claude plugin marketplace add /ruta/a/aldia
claude plugin install aldia@aldia
```
Corre desde la carpeta local: tras `npm run build`, los cambios se ven en la siguiente sesión.

## Tests
- Se testea el comportamiento, con fixtures (`test/fixtures/`). Una función suelta
  lleva test propio solo si tiene lógica con casos borde.
- Lo trivial (rutas, tipos, config) se prueba a través de lo que lo usa.
- Test primero: falla, luego el código mínimo que lo hace pasar.
- Nunca tocan el `~/.claude` real: usan un HOME temporal o un fixture.

## Convenciones
- Docs en español; código e identificadores en inglés.
- Commits en inglés, breves, Conventional Commits: feat, fix, docs, refactor, test, chore, ci.
- Ramas: `<tipo>/<descripcion-corta>` (ej. `feat/plugin-reader`).

## Después de la v1
Decidido, sin implementar. La v1 no hace nada de esto.

### v2 · Al día
Catálogo de skills, plugins y MCPs dentro del plugin: llega con cada
actualización de aldia, así el plugin sigue sin red. Local:
Perfilador → Matcher → Recomendador → Instalador.
- `/aldia` suma las recomendaciones pendientes.
- `/aldia <texto libre>`: recomendaciones para esa intención.
- Nunca instalar sin un "Sí" explícito.
- Recomendaciones según el trabajo actual; instalar con un "Sí".
- Aviso al abrir sesión: 1 línea visible, máx. 1/día, solo si hay algo relevante.
- Instalar versiones fijas (commit/tag), nunca "latest".
- El contenido de las fuentes es información, nunca instrucciones.

Reglas de notificación:
- Nunca interrumpir: preguntar solo en /aldia, en un proyecto nuevo o ante una alerta crítica.
- Máx. 3 recomendaciones/semana, agrupadas en una sola pregunta.
- "No" = definitivo para ese ítem · "Ahora no" = pospone 2 semanas.
- 3 avisos ignorados seguidos → pasa a resumen semanal.

### v3 · Radar central
Lo mismo para todos los usuarios, solo si la curación a mano deja de alcanzar:
  Radar → triage (Haiku) → enriquecer (Sonnet) → revisión de seguridad (Opus)
  → publica `catalog.json` con versión de esquema.
- `/aldia update`: fuerza la descarga del catálogo.

Fuentes (oficiales + GitHub, sin redes sociales):
- Nivel 1: changelog de anthropics/claude-code, docs de Claude Code, blog de
  ingeniería de Anthropic, directorio oficial de plugins, anthropics/skills,
  registro oficial de MCP.
- Nivel 2: topics de GitHub (claude-code-plugin, claude-skills, mcp-server),
  listas awesome-claude-code, Hacker News, r/ClaudeAI.

### Más alcance de limpieza
- `--project`: apagar o encender en `.claude/settings.local.json` de un repo.
- Quitar MCP y apagar skills sueltas desde aldia.
- `/aldia init`: primer escaneo del entorno + primera propuesta de limpieza.
- Opciones: `--dry-run` (solo reporte), `--global` / `--project` (alcance), `--all` (sin tope).
