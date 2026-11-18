import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';

export async function passkeys({req,res,op,owner,fetchDoc,put,privateBlob,hash,token,signIn}){
 const rpID='saldo-ledger.vercel.app',origin='https://'+rpID;
 const registering=op.startsWith('register');
 if(req.headers.origin!==origin)return res.status(400).json({error:'Use saldo-ledger.vercel.app for passkeys.'});
 if(registering&&!owner)return res.status(401).json({error:'Sign in with your account key first.'});
 if(op.endsWith('Options')){
  const options=registering?await generateRegistrationOptions({
   rpName:'Saldo',rpID,userID:Buffer.from(owner,'hex'),userName:'Saldo '+owner.slice(0,8),
   authenticatorSelection:{residentKey:'required',userVerification:'required'},attestationType:'none'
  }):await generateAuthenticationOptions({rpID,userVerification:'required'});
  const secret=token();
  await put('challenges/'+hash(secret),JSON.stringify({challenge:options.challenge,registering,owner,expires:Date.now()+300000}),{...privateBlob,ttlDays:1});
  res.setHeader('Set-Cookie','__Host-saldo-flow='+secret+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300');
  return res.json(options);
 }
 const flow=req.cookies?.['__Host-saldo-flow'];
 if(typeof flow!=='string'||!/^[\w-]{43}$/.test(flow))return res.status(400).json({error:'Start passkey verification again.'});
 const path='challenges/'+hash(flow),doc=await fetchDoc(path),challenge=doc?.data;
 if(!challenge||challenge.used||challenge.expires<Date.now()||challenge.registering!==registering||challenge.owner!==owner)return res.status(400).json({error:'Passkey request expired. Try again.'});
 await put(path,'{"used":true}',{...privateBlob,allowOverwrite:true,ifMatch:doc.version,ttlDays:1});
 const response=req.body.response;
 if(!response||typeof response.id!=='string'||response.id.length>1500)return res.status(400).json({error:'Invalid credential.'});
 const credPath='passkeys/'+hash(response.id);
 const verify={response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true};
 try{
  if(registering){
   const {verified,registrationInfo}=await verifyRegistrationResponse(verify);
   if(!verified)throw Error();
   const {id,publicKey,counter}=registrationInfo.credential;
   await put(credPath,JSON.stringify({owner,id,publicKey:Buffer.from(publicKey).toString('base64url'),counter}),privateBlob);
  }else{
   const stored=await fetchDoc(credPath);if(!stored)throw Error();
   const {publicKey,counter,id}=stored.data;
   const result=await verifyAuthenticationResponse({...verify,credential:{id,publicKey:Buffer.from(publicKey,'base64url'),counter}});
   if(!result.verified)throw Error();
   if(result.authenticationInfo.newCounter!==counter)await put(credPath,JSON.stringify({...stored.data,counter:result.authenticationInfo.newCounter}),{...privateBlob,allowOverwrite:true,ifMatch:stored.version});
   await signIn(res,stored.data.owner);
  }
  return res.json({ok:true});
 }catch{return res.status(400).json({error:'Passkey verification failed. Use your account key or try again.'})}
}
