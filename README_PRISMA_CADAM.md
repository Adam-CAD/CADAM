# CADAM instalado para PRISMA

Repositorio instalado:
`/home/juanpighelfi/Documents/Disenos 3D/PRISMA/07_CADAM`

Repo original:
`https://github.com/Adam-CAD/CADAM`

Estado verificado:

- `npm ci`: OK
- `npx supabase start`: OK
- `npm run typecheck`: OK
- `npm run build`: OK
- servidor dev probado en navegador: OK

URL local:
`http://127.0.0.1:3000/cadam/`

Comandos para levantarlo:

```bash
cd "/home/juanpighelfi/Documents/Disenos 3D/PRISMA/07_CADAM"
npx supabase start
npm run dev -- --host 127.0.0.1
```

Notas importantes:

1. CADAM es una web app Text-to-CAD basada en React/TanStack/Vite + Supabase + OpenSCAD WASM.
2. Para generación real desde la UI necesita al menos una clave de proveedor IA en `.env.local`, por ejemplo:
   - `ANTHROPIC_API_KEY`
   - `OPENROUTER_API_KEY`
   - `OPENAI_API_KEY`
   - `GOOGLE_API_KEY`
3. Dejé `.env.local` configurado con Supabase local y placeholders vacíos para las claves IA.
4. El login/registro local aparece activo; la caja de generación queda deshabilitada hasta iniciar sesión.
5. Para PRISMA, CADAM debe usarse como generador/asistente CAD para base, inserto y encastre. La pantalla se mantiene fija salvo la zona estricta de encastre.

Regla PRISMA vigente:

- La pantalla no se rediseña.
- Sólo se modifica el sistema de encastre/interfaz pantalla-base y, si hace falta, la base/inserto técnico.
- Validar después con OpenSCAD/build123d/CAD, QA de malla, Bambu slicing y render/corte técnico.

## Capa CADAM product designer inspirada en Zoo/KCL

Se agregó una capa v1 para que CADAM no actúe sólo como generador one-shot de OpenSCAD, sino como asistente de diseño de producto paramétrico para piezas imprimibles.

Archivos principales:

- `shared/cadamProductDesigner.ts`: módulo puro con extracción de brief, candidatos, scoring, resumen de trace Zoo/KCL y readiness Gemini/Vertex opcional.
- `src/server/aiChat.ts`: el system prompt paramétrico incorpora `PRODUCT_DESIGNER_PROMPT_EXTENSION`; el modo creative no se toca.
- `src/server/productDesignPlan.ts`: handler offline para planificar producto sin llamar proveedores IA.
- `src/routes/api/product-design-plan.ts`: endpoint POST `/api/product-design-plan` registrado por TanStack Router.
- `scripts/test-cadam-product-designer.mjs`: prueba manual Node sin Vitest/tsx.

Uso del endpoint de planificación:

```bash
curl -sS http://127.0.0.1:3000/cadam/api/product-design-plan \
  -H 'content-type: application/json' \
  -d '{"prompt":"lámpara FDM en dos piezas: exterior PLA premium, interior PETG barato, click fit y cavidades de yeso para lastre"}'
```

La respuesta incluye:

- `brief`: tipo de producto, materiales, fabricación, requisitos de ensamble, cavidades, restricciones, defaults inferidos y riesgos/unknowns.
- `candidates`: estrategias rankeadas como robust baseline, print-optimized, material-efficient, premium shell, modular/repairable y una arquitectura específica para lámparas con ballast/insert.
- `traceSummary` si se envía `traceMarkdown` en el body.
- `gemini`: sólo indica disponibilidad de Gemini/Vertex; no expone secretos y no llama al proveedor.

Inspiración tomada sólo del trace visible Zoo/KCL:

- activación explícita de capacidades/skills;
- lectura de selección y archivos antes de editar;
- búsqueda de conocimiento/samples;
- validación incremental;
- consideración de volumen, superficie, centro de masa, snap/click fits, cavidades de lastre, split PLA/PETG y robustez mecánica.

Gemini/Vertex es opcional:

- El módulo sólo devuelve readiness (`available`, `missing`, `model`, `location`).
- No requiere credenciales para los tests ni para el flujo base.
- Si se configura Vertex, usar variables de entorno compatibles con el proyecto (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, ADC/API key según corresponda). No guardar credenciales en docs ni commits.

Comandos de verificación:

```bash
node --experimental-strip-types scripts/test-cadam-product-designer.mjs
npm run typecheck
npm run build
```
