function setChecked(id) {
   document.getElementById(id).classList.toggle('checked');
}

function clearCheckedItems(listId) {
   var children = document.getElementById(listId).children;
   for (i = 1; i < children.length; i++) {
      if (children[i].classList.contains('checked')) {
         children[i].classList.add('hidden');
      }
   }
}
