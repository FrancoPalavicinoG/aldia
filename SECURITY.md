# Política de seguridad

aldia corre en la máquina de quien lo instala y lee su configuración de Claude Code, el
repo en el que trabaja y el historial de sesiones. El marketplace sirve el plugin desde
la rama `main` de este repo: lo que llega a `main` llega a los usuarios.

## Cómo reportar

Reporta en privado desde la pestaña **Security** del repo, con **Report a vulnerability**
(aviso privado de GitHub). No abras un issue público ni un PR que muestre el problema.

Incluye, si puedes:

- qué hace falta para reproducirlo (un repo de ejemplo, un archivo de config, el comando);
- qué pasa y qué debería pasar;
- la versión de aldia (`plugin/.claude-plugin/plugin.json`), de Claude Code, de git y el
  sistema operativo.

No incluyas credenciales reales ni datos de otras personas: un valor falso alcanza.

## Qué cuenta como vulnerabilidad

- Que el contenido de un repo (archivos, `.git/config`, nombres de carpetas) haga que
  aldia ejecute un programa.
- Que aldia escriba fuera de lo que su documentación permite, o dentro de la carpeta de
  un repo.
- Que aldia cambie la configuración del usuario sin un "Sí" explícito.
- Que datos del usuario (config, repo, historial) salgan de su máquina por una vía que
  aldia agregue.
- Que un secreto de la config (headers, variables de entorno, argumentos o valores de una
  URL) aparezca en lo que aldia muestra.
- Que texto leído de un archivo llegue al reporte disfrazado de otra cosa: una línea o
  sección nueva, caracteres invisibles o instrucciones fuera de la parte marcada como dato.

Que un asunto de commit diga algo como "ignora tus instrucciones" no es una
vulnerabilidad por sí solo: aldia muestra ese texto en una línea, dentro de la sección
marcada como dato. Sí lo es si logra salir de ella.

## Versiones

Solo se corrige la última versión publicada en `main`.
