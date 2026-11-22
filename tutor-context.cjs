// Keep the current puzzle image private to the lesson's in-memory AI context.
// A new image starts a fresh puzzle conversation, as in Homework Helper.
function prepareTutorContext(history,prompt,currentImage,newImage){
 const message={role:'user',text:String(prompt).slice(0,800)};
 const hasNewImage=newImage!==null&&newImage!==undefined;
 return {messages:(hasNewImage?[message]:[...history,message]).slice(-24),image:hasNewImage?newImage:currentImage};
}
module.exports={prepareTutorContext};
