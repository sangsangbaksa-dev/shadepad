const assert=require('node:assert/strict');
module.exports=async function(page,base){
 await page.goto(base+'/app/');await page.waitForSelector('#redact');
 const original='Send to tester@example.com. password=super-secret-123';await page.fill('#input',original);await page.click('#redact');
 const redacted=await page.inputValue('#output');assert.ok(!redacted.includes('tester@example.com'));assert.ok(!redacted.includes('super-secret-123'));
 await page.fill('#reply',redacted);await page.click('#restore');assert.equal(await page.inputValue('#restored'),original);
 await page.click('#backup_box summary');await page.fill('#pass','local-test-passphrase');await page.click('#bk_make');
 await page.waitForFunction(()=>document.querySelector('#backup_out').value.length>40);
 const backup=await page.inputValue('#backup_out');assert.ok(!backup.includes('tester@example.com'));
 await page.reload();await page.click('#backup_box summary');await page.fill('#pass','local-test-passphrase');await page.fill('#backup_in',backup);await page.click('#bk_load');
 await page.waitForFunction(()=>document.querySelectorAll('#tags li').length>0);await page.fill('#reply',redacted);await page.click('#restore');assert.equal(await page.inputValue('#restored'),original);
 const stored=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(!stored.includes('tester@example.com'));
};
