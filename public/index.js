function setChecked(listId, id) {
   document.getElementById(id).classList.toggle('checked');
   checkDisabled(listId);
}

function checkDisabled(listId) {
   var count = 0;
   var children = document.getElementById(listId).children;
   for (i = 0; i < children.length; i++) {
      if (children[i].classList.contains('checked')) {
         count++;
      }
   }
   if (count > 0 && document.getElementById('clearButton').classList.contains('disabled')) {
      document.getElementById('clearButton').classList.toggle('disabled');
   }
   console.log(count);
   if (count <= 0 && !document.getElementById('clearButton').classList.contains('disabled')) {
      document.getElementById('clearButton').classList.toggle('disabled');
   }
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

$('#deleteModal').on('show.bs.modal', function (event) {
   var button = $(event.relatedTarget);
   var id = button.data('id');
   var name = button.data('name');
   var modal = $(this);
   console.log(name);
   modal.find('#listName').text(name);
   document.getElementById('yesButton').setAttribute( "onClick",'deleteList('+id+');');
})

function deleteList(listId) {
   console.log(listId);
   fetch('/l/delList/', {
      method: 'POST',
      headers: {
         'Content-Type': 'application/json'
      },
      body: JSON.stringify({
         list: listId
      })
   });
   window.location.href='/';
}
