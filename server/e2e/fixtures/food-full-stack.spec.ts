// Source-grounded acceptance suite for the imported Food Ordering regression.
// The managed Full Stack runner binds request to the owned real backend.
import {test,expect} from '@playwright/test';
const image='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3C/svg%3E';
const create=async(request,name)=>{
  const response=await request.post('/api/food-items/create/',{data:{name,image,price:150000,rating:4.5,category:'Pizza',isAvailable:'true'}});
  expect(response.status()).toBe(201);
  return response.json();
};
test.describe.configure({mode:'serial'});

test('READ - display food loaded from the real API and database',async({page,request})=>{
  const name=`Runtime food ${Date.now()}`;
  let food;
  try {
    await test.step('Setup: create a unique food through the real backend',async()=>{food=await create(request,name);});
    await test.step('Action: READ - open the menu',async()=>{await page.goto('/',{waitUntil:'domcontentloaded'});});
    await test.step('Assert: the persisted food appears in the menu and API',async()=>{
      await expect(page.getByText(name,{exact:true})).toBeVisible();
      const response=await request.get('/api/food-items');expect(response.status()).toBe(200);
      expect((await response.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({id:food.id,name})]));
    });
    await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
  } finally {if(food)await test.step('Cleanup: remove the prerequisite food',async()=>{expect((await request.delete(`/api/food-items/delete/${food.id}`)).status()).toBe(200);});}
});

test('UPDATE - persist a food name change and display it after reload',async({page,request})=>{
  const name=`Original food ${Date.now()}`,updated=`Updated ${name}`;
  let food;
  try {
    await test.step('Setup: create and display an independent food',async()=>{food=await create(request,name);await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByText(name,{exact:true})).toBeVisible();});
    await test.step('Action: UPDATE - change the food name through the supported API',async()=>{const response=await request.put(`/api/food-items/update/${food.id}`,{data:{name:updated}});expect(response.status()).toBe(200);});
    await test.step('Assert: reload reflects the persisted updated name',async()=>{
      await page.reload({waitUntil:'domcontentloaded'});
      await expect(page.getByText(updated,{exact:true})).toBeVisible();await expect(page.getByText(name,{exact:true})).toHaveCount(0);
      const response=await request.get(`/api/food-items/get/${food.id}`);expect(response.status()).toBe(200);expect((await response.json()).name).toBe(updated);
    });
    await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
  } finally {if(food)await test.step('Cleanup: remove the prerequisite food',async()=>{expect((await request.delete(`/api/food-items/delete/${food.id}`)).status()).toBe(200);});}
});

test('DELETE - remove a persisted food from the API and reloaded menu',async({page,request})=>{
  const name=`Delete food ${Date.now()}`;let food,deleted=false;
  try {
    await test.step('Setup: create and display an independent food',async()=>{food=await create(request,name);await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByText(name,{exact:true})).toBeVisible();});
    await test.step('Action: DELETE - delete the food through the supported API',async()=>{const response=await request.delete(`/api/food-items/delete/${food.id}`);expect(response.status()).toBe(200);deleted=true;});
    await test.step('Assert: the deleted food is absent from the API and menu',async()=>{
      const response=await request.get('/api/food-items');expect(response.status()).toBe(200);expect((await response.json()).data.some(item=>item.id===food.id)).toBe(false);
      await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'MENU',exact:true})).toBeVisible();await expect(page.getByText(name,{exact:true})).toHaveCount(0);
    });
    await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
  } finally {if(food&&!deleted)await test.step('Cleanup: remove the prerequisite food',async()=>{expect((await request.delete(`/api/food-items/delete/${food.id}`)).status()).toBe(200);});}
});
