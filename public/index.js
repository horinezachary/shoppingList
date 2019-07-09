function setChecked(id) {
   document.getElementById(id).classList.toggle('checked');
}

function clearCheckedItems(listId) {
   var children = document.getElementById(listId).children;
   for (i = 0; i < children.length; i++) {
      if (children[i].classList.contains('checked')) {
         children[i].classList.add('hidden');
      }
   }
}

function deleteItems(list,listId) {
   var children = document.getElementById(listId).children;
   var arr = [];
   for (i = 0; i < children.length; i++) {
      if (children[i].classList.contains('checked')) {
         children[i].classList.add('hidden');
         arr.push(children[i].id);
      }
   }
   fetch('/l/delItem/'+list, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        items: arr
    })
});
}
