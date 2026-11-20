import {mkdir,copyFile,cp} from 'node:fs/promises';
const out='public/assets/';
await mkdir(out,{recursive:true});
const files={
 'descope.js':'@descope/web-component/dist/index.js',
 'passkey.js':'@simplewebauthn/browser/dist/bundle/index.umd.min.js',
 'ocr.js':'tesseract.js/dist/tesseract.min.js','worker.min.js':'tesseract.js/dist/worker.min.js',
 'eng.traineddata.gz':'@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
};
for(const name of ['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js'])files[name]='tesseract.js-core/'+name;
for(const [name,path] of Object.entries(files))await copyFile('node_modules/'+path,out+name);

const pdfRoot='node_modules/pdfjs-dist/';
const pdfOut='public/vendor/pdfjs/';
await mkdir(pdfOut,{recursive:true});
for(const file of ['pdf.mjs','pdf.worker.mjs'])await copyFile(pdfRoot+'legacy/build/'+file,pdfOut+file);
for(const directory of ['cmaps','standard_fonts'])await cp(pdfRoot+directory,pdfOut+directory,{recursive:true});
