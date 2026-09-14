# Actividad de GitHub en el perfil

Settings → Profile muestra el calendario real de contribuciones de la cuenta GitHub indicada en el encabezado. La consulta de sólo lectura utiliza `viewer.contributionsCollection.contributionCalendar` de la [API oficial](https://docs.github.com/en/graphql/reference/users), sin pedir permisos adicionales ni recurrir a servicios de terceros. La visibilidad de contribuciones privadas depende de la cuenta y sus permisos existentes.

`OpenideGitHubActivity` mantiene las credenciales en la capa de consulta y devuelve sólo fechas, conteos y niveles. La caché vive cinco minutos en memoria y se invalida al cambiar la sesión. Actualizar omite la caché; salir de la página cancela la solicitud. Los errores de autenticación, permisos/límites o conexión se distinguen de un año sin contribuciones. No hay consultas periódicas.

`OpenideActivityCalendar` es el componente reutilizable del workbench: usa colores del tema, hover nativo y un único punto de entrada por Tab. Flechas verticales recorren días, horizontales semanas, Home/End los extremos. La cuadrícula está limitada a un año y no se reconstruye al redimensionar. No necesita una librería de gráficos. Los conteos corresponden a contribuciones de GitHub, no al consumo de tokens de OpenIDE.

Validación: pruebas Chromium de caché/refresh, cierre de sesión, aislamiento entre cuentas, límites, cero contribuciones, cancelación y teclado; verificación visual adicional con la cuenta conectada.
