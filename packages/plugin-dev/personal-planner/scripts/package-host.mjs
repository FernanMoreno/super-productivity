import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const plugin = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const browser = path.join(repo, '.tmp/angular-dist/browser');
await access(path.join(browser, 'index.html'));
await access(path.join(repo, '.tmp/angular-dist/3rdpartylicenses.txt'));
const dist = path.join(plugin, 'dist');
await mkdir(dist, { recursive: true });
const guide = `SUPER PRODUCTIVITY — MI PLANIFICACIÓN

Compilación web local de desarrollo con la corrección de guardado durable.
No es un instalador de escritorio. Conserva licencias y créditos originales.

Requiere Python 3 para servir archivos locales (sin backend adicional).
1. Extrae TODO este ZIP en una carpeta.
2. Abre una terminal en esa carpeta y ejecuta:
   python3 -m http.server 4255 --bind 127.0.0.1 --directory web
   En Windows usa python o py en lugar de python3, según tu instalación.
3. Abre http://localhost:4255 en el navegador.
4. En Ajustes > Plugins importa personal-planner.zip y actívalo.
5. Abre Mi planificación. Puedes empezar vacío o cargar la demo ficticia.
6. Para tu perfil privado, importa su JSON desde la configuración del panel.

Los datos se guardan en el almacenamiento del navegador para ese origen.
Mantén la misma dirección/puerto/navegador. Exporta copias privadas antes de
cambiar de origen, borrar datos del navegador o actualizar la aplicación.
Detén el servidor con Ctrl+C. No abras web/index.html con doble clic.

Instalación, uso, actualización, límites y pruebas: README.md y VALIDACION.md.
La sincronización y servicios externos siguen siendo opcionales del anfitrión.
No se incluye ningún perfil personal, registro ni tarea del usuario.
`;
await writeFile(path.join(dist, 'LEEME-WEB.txt'), guide);
for (const file of ['README.md', 'VALIDACION.md']) {
  await copyFile(path.join(plugin, file), path.join(dist, file));
}
const output = path.join(dist, 'super-productivity-planner-web.zip');
execFileSync('python3', [
  '-c',
  `import pathlib,sys,zipfile
browser,dist,repo,out=map(pathlib.Path,sys.argv[1:])
files=[(p,'web/'+p.relative_to(browser).as_posix()) for p in browser.rglob('*') if p.is_file()]
files += [(repo/'LICENSE','LICENSE'),(repo/'.tmp/angular-dist/3rdpartylicenses.txt','3rdpartylicenses.txt'),(dist/'personal-planner.zip','personal-planner.zip'),(dist/'LEEME-WEB.txt','LEEME-WEB.txt'),(dist/'README.md','README.md'),(dist/'VALIDACION.md','VALIDACION.md')]
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p,name in sorted(files,key=lambda item:item[1]):
  if p.is_symlink(): raise ValueError('Unexpected symlink: '+str(p))
  info=zipfile.ZipInfo(name,date_time=(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16
  z.writestr(info,p.read_bytes())
print('Paquete web local creado:',out)`,
  browser,
  dist,
  repo,
  output,
]);
