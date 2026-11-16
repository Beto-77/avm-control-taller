# AVM | Control de taller

Aplicación web adaptable a celulares y computadoras para el control de motos, órdenes y clientes. Los usuarios acceden mediante un enlace en el navegador; no se requiere instalar una aplicación. Netlify publica el sitio y Supabase proporciona inicio de sesión, base de datos y permisos por fila.

## Puesta en marcha

1. Crea un proyecto Supabase bajo la cuenta de la organización y conserva allí los datos. No compartas la clave `service_role`.
2. En Supabase, abre **SQL Editor**, ejecuta `supabase/schema.sql` y espera a que termine sin errores.
3. En **Authentication → Users**, crea la primera cuenta con su correo y contraseña. Confirma la cuenta al crearla si Supabase muestra esa opción; el esquema crea los perfiles nuevos como Técnico por defecto. Luego, desde **SQL Editor**, asigna el primer rol:

   ```sql
   update public.profiles
   set role = 'admin', display_name = 'Administrador'
   where email = 'admin@tu-dominio.com';
   ```

4. El Administrador crea las cuentas de Técnicos o Administradores desde **Equipo → Crear usuario**, definiendo el correo de inicio de sesión y una contraseña inicial. Supabase confirma la cuenta sin enviar correo, por lo que no se requiere SMTP. Desde **Equipo → Editar cuenta**, el Administrador también puede establecer una contraseña nueva.
5. Copia `.env.example` a `.env` y completa la URL del proyecto Supabase y su clave publicable (o `anon`) en **Project Settings → API**.
6. Instala y ejecuta:

   ```powershell
   npm install
   npm run dev
   ```

7. La Supabase CLI está incluida como dependencia local del proyecto. Inicia sesión y vincula el proyecto desde PowerShell:

   ```powershell
   npx supabase login
   npx supabase link --project-ref TU_PROJECT_REF
   ```

8. Despliega la función segura que crea cuentas y establece contraseñas desde el Administrador. Sustituye la URL por el sitio Netlify publicado; añade cualquier URL local que uses a `APP_URLS` separándola por comas:

   ```powershell
   npx supabase secrets set APP_URLS="https://tu-sitio.netlify.app,http://localhost:5173"
   npx supabase functions deploy admin-create-user
   ```

   La función usa las variables administradas `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del entorno de Supabase. La clave `service_role` nunca debe copiarse a la aplicación ni a Netlify.
9. En Netlify, importa esta carpeta como sitio. La configuración de `netlify.toml` define `npm run build` y `dist`. Crea `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en **Site configuration → Environment variables** y publica el sitio. Añade la URL publicada a **Authentication → URL Configuration** en Supabase.
10. Inicia sesión con el Administrador y usa **Equipo → Crear usuario** para crear las cuentas del personal.

## Contraseñas y correo

No se envían invitaciones ni enlaces de restablecimiento: las cuentas se confirman al crearse y el Administrador puede establecer una contraseña nueva desde **Equipo → Editar cuenta**. Si una persona olvida su contraseña, debe contactar al Administrador. El correo se usa como nombre de usuario de Supabase, pero no se envía ningún mensaje a esa dirección. No compartas contraseñas en canales públicos; usa una contraseña única para cada cuenta.

## Permisos

- **Administrador:** puede consultar y editar clientes y todas las órdenes, importar datos, crear órdenes, asignar técnicos y gestionar las cuentas, roles y contraseñas.
- **Técnico:** solo consulta las órdenes asignadas a su cuenta y los clientes vinculados a esas órdenes. No puede modificar registros ni consultar adelantos, pagos o ganancias. Estas reglas se aplican en PostgreSQL con Row Level Security y una vista limitada, no solo en la interfaz.
- Las nuevas cuentas se crean desde **Equipo** usando una función de Supabase protegida con JWT y verificación del rol Administrador. Las contraseñas se envían directamente a Supabase; nunca se guardan en la base de datos de la aplicación ni se registran en la función. El esquema bloquea la eliminación o degradación del último Administrador.

## Importación del Excel

Se reconocen las pestañas `Control diario` y `Directorio de Clientes`, con los encabezados de la plantilla actual. Se importan estados, datos de órdenes, asignación por `TRABAJADO POR`, fechas, repuestos, costos, adelantos, pagos, ganancias, observaciones y campos del directorio. Los tipos de cliente disponibles en la hoja (`VIP`, `Frecuente`, `Regular`, `Nuevo`) se conservan como opciones; filas sin datos identificativos no se crean como clientes. La carga se ejecuta en el navegador autenticado y los datos viajan directamente a tu proyecto Supabase; el archivo no se envía a Netlify.

Las órdenes importadas se vinculan a una cuenta técnica solo si el nombre de `TRABAJADO POR` coincide con el nombre visible de su perfil. Las filas sin coincidencia quedan sin asignar y no aparecen en ninguna cuenta técnica hasta que el Administrador las asigne.

## Desarrollo

```powershell
npm run build
npm run preview
```

La aplicación necesita conexión a internet para iniciar sesión y cargar datos. Desde el celular, basta con abrir el enlace publicado en el navegador; la interfaz se adapta al tamaño de la pantalla y no requiere instalación.
