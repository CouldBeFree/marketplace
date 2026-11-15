// Дочірній процес для demo:upload: кладе байти за presigned URL. У його оточенні НЕМАЄ жодного
// STORAGE-ключа (parent форкає з чистим env) — це й доводить, що байти доїжджають у сховище
// повз наш сервіс. Імпортів нема навмисно: процес не піднімає ні AppModule, ні SDK.
async function main(): Promise<void> {
  const url = process.env.PUT_URL;
  const body = Buffer.from(process.env.PUT_BODY_B64 ?? '', 'base64');
  const contentType = process.env.PUT_CT ?? 'application/octet-stream';
  if (!url) throw new Error('PUT_URL відсутній');
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body });
  process.send?.({ status: res.status }, () => process.exit(0));
}

main().catch((err) => {
  console.error('put-child FAILED:', err);
  process.exit(1);
});
