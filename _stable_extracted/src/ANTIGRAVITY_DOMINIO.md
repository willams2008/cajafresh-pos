# CÓMO USAR TU DOMINIO NIC.VE CON LA POS

## Situación actual
Sin token → Quick Tunnel → URL aleatoria `xyz123.trycloudflare.com` que **cambia cada vez que reinicias la app**.

## Con tu dominio nic.ve configurado
Con token → **URL fija** como `caja.tudominio.com.ve` que **nunca cambia**, aunque reinicies la app, el PC o el internet.

---

## Paso 1: Apuntar tu dominio a Cloudflare (gratis)

1. Ve a **nic.ve** y busca la opción de **cambiar nameservers**
2. Reemplaza los nameservers actuales por los de Cloudflare:
   ```
   darl.ns.cloudflare.com
   dave.ns.cloudflare.com
   ```
   (Cloudflare te asigna 2 específicos al agregar el dominio. Te aparecen en el paso 2.)

3. Espera 5-30 min a que se propaguen los DNS.

## Paso 2: Agregar tu dominio en Cloudflare

1. Crea una cuenta en **https://dash.cloudflare.com** (gratis)
2. Haz clic en **Add a Site** y escribe tu dominio (`tudominio.com.ve`)
3. Cloudflare escanea los registros DNS actuales (cópialos si hay alguno)
4. Selecciona el plan **Free** ($0)
5. Te asignará 2 nameservers. Cópialos.

## Paso 3: Cambiar los nameservers en nic.ve

1. Ve a **https://nic.ve** → administración de dominio
2. Cambia los nameservers por los que te dio Cloudflare
3. Guarda. Espera unos minutos.

## Paso 4: Crear el Tunnel en Cloudflare

1. En Cloudflare Dashboard, ve a **Zero Trust** (menú izquierdo)
2. **Networks** → **Tunnels**
3. **Create a tunnel**
4. Tipo: **cloudflared**
5. Dale un nombre, ej: `caja-pos-tunnel`
6. Te aparecerá un **token** como este:
   ```
   eyJhIjoiZGI3Y...
   ```
7. **Guarda ese token** en un bloc de notas

## Paso 5: Configurar el túnel en Cloudflare

1. En la página de tu túnel ya creado, ve a la pestaña **Public Hostname**
2. Agrega uno nuevo:
   - **Subdomain:** `caja` (o el que quieras)
   - **Domain:** elige tu dominio (`tudominio.com.ve`)
   - **Type:** `HTTP`
   - **URL:** `http://localhost:3000` (el puerto donde corre la POS local)
3. Guarda.

Tu URL será: **https://caja.tudominio.com.ve**

## Paso 6: Configurar en la POS

1. Abre la POS
2. Ve a **Configuración** → apartado de **Cloud / Túnel**
3. En **Cloudflare Domain:** escribe `caja.tudominio.com.ve`
4. En **Cloudflare Token:** pega el token del paso 4
5. Guarda

## Paso 7: Verificar

1. Reinicia la POS
2. En la vista **App Móvil**, deberías ver tu dominio fijo en el QR
3. Escanea el QR con un celular — debe abrir `https://caja.tudominio.com.ve` y verse la POS

---

## Resumen de comandos útiles

```bash
# Verificar si el túnel está activo desde terminal:
cloudflared tunnel list

# Verificar DNS:
nslookup caja.tudominio.com.ve

# Probar conexión desde afuera:
curl -I https://caja.tudominio.com.ve
```

## Si algo falla

| Problema | Causa más común | Solución |
|----------|----------------|----------|
| No carga la URL | DNS no propagado | Esperar 30 min o verificar nameservers en nic.ve |
| Error 526 (SSL inválido) | Cloudflare no generó certificado | En Cloudflare → SSL/TLS → Full (strict) |
| Tunnel no conecta | Token mal copiado | Regenerar token en Cloudflare Zero Trust |
| QR no actualizado | App móvil tiene URL vieja | Cerrar sesión en app móvil y volver a escanear |

El proceso completo toma 10 minutos si los DNS ya están propagados.
