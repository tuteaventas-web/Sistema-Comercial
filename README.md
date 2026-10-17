# Sistema Comercial

Sistema local para gestionar documentos físicos de clientes, su ubicación y su historial.

## Funciones

- Clientes con uno o dos nombres y códigos vinculados.
- Búsqueda con sugerencias por nombre o código.
- Ingreso de varios tipos de documento, con cantidad independiente por tipo.
- Registro de destinos, almacenamiento, entregas y reciclaje.
- Historial de movimientos y ediciones con el usuario de la sesión.
- Cuentas de administrador y asesores, catálogos ordenables y auditoría.
- Exportación Excel con rango de fechas y resúmenes imprimibles.
- Tarjetas uniformes e interfaz adaptable.

## Requisitos

- Node.js 24 o posterior.
- PostgreSQL local y sus herramientas de línea de comandos.
- npm o pnpm.

## Instalar y ejecutar en Windows

```powershell
npm install
$env:PG_BIN='C:/ruta/postgresql/bin'
node scripts/local.ts setup
node scripts/local.ts start
```

También se puede iniciar con `Iniciar.cmd`. La aplicación se abre en http://127.0.0.1:3000.

El comando de configuración genera los archivos privados locales necesarios. Las credenciales iniciales están en `.local/acceso-inicial.txt`. Para cambiar la contraseña administrativa, ejecutar `node src/password.ts` en una terminal interactiva y reiniciar el servidor.

Si se utiliza una base de datos existente, configurar `.env` siguiendo `.env.example`. La plantilla no contiene credenciales reales. El servidor aplica la migración al arrancar.

## Comprobaciones

```powershell
npm run check
npm test
node --check public/app.js
```

Las pruebas de integración usan una base aislada. Necesitan las herramientas PostgreSQL y pueden omitir su ejecución cuando faltan los binarios. `PG_BIN` permite indicar dónde están instalados.

## Estructura

- `public/`: interfaz HTML, CSS y JavaScript.
- `src/`: servidor, reglas de negocio, importación y credenciales.
- `migrations/`: estructura de PostgreSQL.
- `scripts/`: inicio local y diagnósticos.
- `tests/`: pruebas de interfaz, dominio e integración.

## Datos y configuración privada

Este repositorio contiene código y pruebas con datos ficticios. No incluye la base de clientes, archivos Excel importados, capturas de pantalla, respaldos, archivos `.env` ni claves privadas.

Los archivos `.local/`, `.env` y los respaldos se conservan fuera de Git. Para trasladar una instalación existente se necesita su respaldo PostgreSQL y la configuración privada correspondiente; clonar este repositorio no copia los datos del sistema.

Las cuentas de asesores usan hashes para autenticarse. La copia cifrada que permite al administrador consultar contraseñas nuevas depende de `.local/advisor-credentials.key`; conservar esa clave de forma privada junto con los respaldos necesarios.

La publicación del código no despliega un servidor ni hace accesible la aplicación por Internet.

## Despliegue en Vercel + Supabase

La rama `deploy/vercel` permite publicar el sistema en internet sin cambiar el uso local.

- `pnpm run build` genera `.vercel/output` (Build Output API) con una sola función Node que sirve la interfaz y la API.
- Variables de entorno requeridas en Vercel:
  - `DATABASE_URL`: cadena del pooler de Supabase (modo transacción, puerto 6543) con `?sslmode=no-verify`.
  - `ADMIN_PASSWORD_HASH`: `sal:hash` scrypt, el mismo formato que genera `node src/password.ts`.
  - `ADVISOR_CREDENTIALS_KEY`: 32 bytes en base64; reemplaza a `.local/advisor-credentials.key`.
- Las sesiones se guardan en la tabla `app_sessions` para funcionar entre instancias; la migración la crea al arrancar.
- Vercel limita el cuerpo de cada petición a 4,5 MB, por lo que los Excel a importar deben ser menores a ese tamaño.
