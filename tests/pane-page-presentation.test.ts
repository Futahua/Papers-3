import {it,expect} from 'vitest';import {snapPageBounds,pagePresentationSettled} from '../src/main/backpacks/panePagePresentation';
it('settles hosted AYG geometry at fractional display scaling instead of feeding updates back forever',()=>{
 const reported={x:7.8571429909,y:40.0000012772,width:444.2857218519,height:378.5714350185},native=snapPageBounds(reported);
 expect(native).toEqual({x:8,y:40,width:444,height:379});expect(pagePresentationSettled(native,true,reported,true)).toBe(true);
 expect(pagePresentationSettled({...native,width:443},true,reported,true)).toBe(false);expect(pagePresentationSettled(native,false,reported,true)).toBe(false);
});
