import {mkdir,copyFile} from 'node:fs/promises';
const out='public/assets/';
await mkdir(out,{recursive:true});
const files={
 'passkey.js':'@simplewebauthn/browser/dist/bundle/index.umd.min.js',
 'ocr.js':'tesseract.js/dist/tesseract.min.js','worker.min.js':'tesseract.js/dist/worker.min.js',
 'eng.traineddata.gz':'@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
};
for(const name of ['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js'])files[name]='tesseract.js-core/'+name;
for(const [name,path] of Object.entries(files))await copyFile('node_modules/'+path,out+name);
