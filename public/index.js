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

$('#editModal').on('show.bs.modal', function (event) {
   var button = $(event.relatedTarget);
   var id = button.data('id');
   var name = button.data('name');
   var color = button.data('listcolor');
   var modal = $(this);
   var colorbuttons = document.getElementsByClassName('editRadio');
   for (i = 0; i < colorbuttons.length; i++) {
      console.log(colorbuttons[i].value);
      if (colorbuttons[i].value == color) {
         colorbuttons[i].setAttribute("checked", "checked");
         console.log("found it!");
      }
   }
   modal.find('#modalTitle').text("Edit List: "+name);
   document.getElementById('nameInput').setAttribute( "value", name);
   document.getElementById('editForm').setAttribute( "action",'editList/'+id);
})



$('#deleteModal').on('show.bs.modal', function (event) {
   var button = $(event.relatedTarget);
   var id = button.data('id');
   var name = button.data('name');
   var modal = $(this);
   modal.find('#listName').text(name);
   document.getElementById('yesButton').setAttribute( "onClick",'deleteList('+id+');');
})

function deleteList(listId) {
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

function showField(id) {
   var fields = ["nameFields","emailField", "password1Field", "password2Field"];
   for(i = 0; i < fields.length; i++){
      if (!document.getElementById(fields[i]).classList.contains('hidden')) {
         document.getElementById(fields[i]).classList.toggle('hidden');
      }
      document.getElementById(fields[i]).children[1].required = false;
      document.getElementById(fields[i]).children[1].value = "";
      if (fields[i] == "nameFields") {
         document.getElementById(fields[i]).children[2].required = false;
         document.getElementById(fields[i]).children[2].value = "";
      }
   }
   if (id == 'passwords') {
      document.getElementById('password1Field').classList.toggle('hidden');
      document.getElementById('password2Field').classList.toggle('hidden');
      document.getElementById('password1Field').children[1].required = true;
      document.getElementById('password2Field').children[1].required = true;
      //set required
   } else {
      document.getElementById(id).classList.toggle('hidden');
      document.getElementById(id).children[1].required = true;
      if (id == "nameFields") {
         document.getElementById(id).children[2].required = true;
      }
      //set required
   }
}
